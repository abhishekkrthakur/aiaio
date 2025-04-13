import asyncio
import base64
import os
import re
import sqlite3
import tempfile
import time
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from openai import OpenAI
from pydantic import BaseModel

from aiaio import __version__, logger
from aiaio.db import ChatDatabase
from aiaio.prompts import SUMMARY_PROMPT


logger.info("aiaio...")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = FastAPI()
static_path = os.path.join(BASE_DIR, "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")
templates_path = os.path.join(BASE_DIR, "templates")
templates = Jinja2Templates(directory=templates_path)

# Create temp directory for uploads
TEMP_DIR = Path(tempfile.gettempdir()) / "aiaio_uploads"
TEMP_DIR.mkdir(exist_ok=True)

# Initialize database
db = ChatDatabase()


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # Use dict instead of list
        self.active_generations: Dict[str, bool] = {}  # Track active generations

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.active_generations[client_id] = False

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.active_generations:
            del self.active_generations[client_id]

    def set_generating(self, client_id: str, is_generating: bool):
        self.active_generations[client_id] = is_generating

    def should_stop(self, client_id: str) -> bool:
        return not self.active_generations.get(client_id, False)

    async def broadcast(self, message: dict):
        for connection in self.active_connections.values():
            try:
                await connection.send_json(message)
            except Exception:
                # If sending fails, we'll handle it in the main websocket route
                pass


manager = ConnectionManager()


class FileAttachment(BaseModel):
    """
    Pydantic model for handling file attachments in messages.

    Attributes:
        name (str): Name of the file
        type (str): MIME type of the file
        data (str): Base64 encoded file data
    """

    name: str
    type: str
    data: str


class MessageContent(BaseModel):
    """
    Pydantic model for message content including optional file attachments.

    Attributes:
        text (str): The text content of the message
        files (List[FileAttachment]): Optional list of file attachments
    """

    text: str
    files: Optional[List[FileAttachment]] = None


class ChatInput(BaseModel):
    """
    Pydantic model for chat input data.

    Attributes:
        message (str): The user's message content
        system_prompt (str): Instructions for the AI model
        conversation_id (str, optional): ID of the conversation
    """

    message: str
    system_prompt: str
    conversation_id: Optional[str] = None


class MessageInput(BaseModel):
    """
    Pydantic model for message input data.

    Attributes:
        role (str): The role of the message sender (e.g., 'user', 'assistant', 'system')
        content (str): The message content
        content_type (str): Type of content, defaults to "text"
        attachments (List[Dict], optional): List of file attachments
    """

    role: str
    content: str
    content_type: str = "text"
    attachments: Optional[List[Dict]] = None


class SettingsInput(BaseModel):
    """
    Pydantic model for AI model settings.

    Attributes:
        name (str): Name of the settings configuration
        temperature (float): Controls randomness in responses
        max_tokens (int): Maximum length of generated responses
        top_p (float): Controls diversity via nucleus sampling
        host (str): API endpoint URL
        model_name (str): Name of the AI model to use
        api_key (str): Authentication key for the API
    """

    name: str
    temperature: Optional[float] = 1.0
    max_tokens: Optional[int] = 4096
    top_p: Optional[float] = 0.95
    host: Optional[str] = "http://localhost:8000/v1"
    model_name: Optional[str] = "meta-llama/Llama-3.2-1B-Instruct"
    api_key: Optional[str] = ""


class PromptInput(BaseModel):
    """
    Pydantic model for system prompt input.

    Attributes:
        name (str): Name of the prompt
        text (str): The prompt text content
    """

    name: str
    text: str


class MessageEdit(BaseModel):
    """
    Pydantic model for message edit requests.

    Attributes:
        content (str): New message content
    """

    content: str


@dataclass
class RequestContext:
    is_disconnected: bool = False


# Create a context variable to track request state
request_context: ContextVar[RequestContext] = ContextVar("request_context", default=RequestContext())


async def text_streamer(messages: List[Dict[str, str]], client_id: str):
    """Stream text responses from the AI model."""
    formatted_messages = []

    for msg in messages:
        formatted_msg = {"role": msg["role"]}
        attachments = msg.get("attachments", [])

        if attachments:
            # Handle messages with attachments
            content = []
            if msg["content"]:
                content.append({"type": "text", "text": msg["content"]})

            for att in attachments:
                file_type = att.get("file_type", "").split("/")[0]
                with open(att["file_path"], "rb") as f:
                    file_data = base64.b64encode(f.read()).decode()

                content_type_map = {"image": "image_url", "video": "video_url", "audio": "input_audio"}

                url_key = content_type_map.get(file_type, "file_url")
                content.append({"type": url_key, url_key: {"url": f"data:{att['file_type']};base64,{file_data}"}})

            formatted_msg["content"] = content
        else:
            # Handle text-only messages
            formatted_msg["content"] = msg["content"]

        formatted_messages.append(formatted_msg)

    db_settings = db.get_settings()
    if not db_settings:
        raise HTTPException(status_code=404, detail="No default settings found")

    client = OpenAI(
        api_key=db_settings["api_key"] if db_settings["api_key"] != "" else "empty",
        base_url=db_settings["host"],
    )

    stream = None
    try:
        manager.set_generating(client_id, True)
        stream = client.chat.completions.create(
            messages=formatted_messages,
            model=db_settings["model_name"],
            max_completion_tokens=db_settings["max_tokens"],
            temperature=db_settings["temperature"],
            top_p=db_settings["top_p"],
            stream=True,
        )

        for message in stream:
            if manager.should_stop(client_id):
                logger.info(f"Stopping generation for client {client_id}")
                break

            if message.choices and len(message.choices) > 0:
                if message.choices[0].delta.content is not None:
                    yield message.choices[0].delta.content

    except Exception as e:
        logger.error(f"Error in text_streamer: {e}")
        raise

    finally:
        manager.set_generating(client_id, False)
        if stream and hasattr(stream, "response"):
            stream.response.close()


@app.get("/", response_class=HTMLResponse)
async def load_index(request: Request):
    """
    Serve the main application page.

    Args:
        request (Request): FastAPI request object

    Returns:
        TemplateResponse: Rendered HTML template
    """
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )


@app.get("/version")
async def version():
    """
    Get the application version.

    Returns:
        dict: Version information
    """
    return {"version": __version__}


@app.get("/conversations")
async def get_conversations():
    """
    Retrieve all conversations.

    Returns:
        dict: List of all conversations

    Raises:
        HTTPException: If database operation fails
    """
    try:
        conversations = db.get_all_conversations()
        return {"conversations": conversations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """
    Retrieve a specific conversation's history.

    Args:
        conversation_id (str): ID of the conversation to retrieve

    Returns:
        dict: Conversation messages

    Raises:
        HTTPException: If conversation not found or operation fails
    """
    try:
        history = db.get_conversation_history(conversation_id)
        if not history:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"messages": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/create_conversation")
async def create_conversation():
    """
    Create a new conversation.

    Returns:
        dict: New conversation ID

    Raises:
        HTTPException: If creation fails
    """
    try:
        conversation_id = db.create_conversation()
        await manager.broadcast({"type": "conversation_created", "conversation_id": conversation_id})
        return {"conversation_id": conversation_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/conversations/{conversation_id}/messages")
async def add_message(conversation_id: str, message: MessageInput):
    """
    Add a message to a conversation.

    Args:
        conversation_id (str): Target conversation ID
        message (MessageInput): Message data to add

    Returns:
        dict: Added message ID

    Raises:
        HTTPException: If operation fails
    """
    try:
        message_id = db.add_message(
            conversation_id=conversation_id,
            role=message.role,
            content=message.content,
            content_type=message.content_type,
            attachments=message.attachments,
        )
        return {"message_id": message_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/messages/{message_id}")
async def edit_message(message_id: str, edit: MessageEdit):
    """
    Edit an existing message.

    Args:
        message_id (str): ID of the message to edit
        edit (MessageEdit): New message content

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If message not found or edit not allowed
    """
    try:
        success = db.edit_message(message_id, edit.content)
        if not success:
            raise HTTPException(status_code=404, detail="Message not found")

        # Get message role to send in broadcast
        with sqlite3.connect(db.db_path) as conn:
            conn.row_factory = sqlite3.Row
            msg = conn.execute("SELECT role FROM messages WHERE message_id = ?", (message_id,)).fetchone()

        # Broadcast update to all connected clients
        await manager.broadcast(
            {"type": "message_edited", "message_id": message_id, "content": edit.content, "role": msg["role"]}
        )

        return {"status": "success"}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/messages/{message_id}/raw")
async def get_raw_message(message_id: str):
    """Get the raw content of a message.

    Args:
        message_id (str): ID of the message to retrieve

    Returns:
        dict: Message content

    Raises:
        HTTPException: If message not found
    """
    try:
        with sqlite3.connect(db.db_path) as conn:
            conn.row_factory = sqlite3.Row
            message = conn.execute("SELECT content FROM messages WHERE message_id = ?", (message_id,)).fetchone()

            if not message:
                raise HTTPException(status_code=404, detail="Message not found")

            return {"content": message["content"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """
    Delete a conversation.

    Args:
        conversation_id (str): ID of conversation to delete

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If deletion fails
    """
    try:
        db.delete_conversation(conversation_id)
        await manager.broadcast({"type": "conversation_deleted", "conversation_id": conversation_id})
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save_settings")
async def save_settings(settings: SettingsInput):
    """Save AI model settings.

    Args:
        settings (SettingsInput): Settings to save

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If save operation fails or name already exists
    """
    try:
        settings_dict = settings.model_dump()
        settings_dict["updated_at"] = time.time()  # Add timestamp
        settings_dict["created_at"] = time.time()  # Add creation timestamp for new settings
        db.save_settings(settings_dict)
        return {"status": "success"}
    except sqlite3.IntegrityError as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="A settings configuration with this name already exists")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/settings")
async def get_settings():
    """
    Retrieve current default settings configuration.

    Returns:
        dict: Current default settings

    Raises:
        HTTPException: If retrieval fails
    """
    try:
        settings = db.get_settings()
        if not settings:
            raise HTTPException(status_code=404, detail="No default settings found")
        return settings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/settings")
async def create_settings(settings: SettingsInput):
    """Create a new settings configuration.

    Args:
        settings (SettingsInput): Settings data to create

    Returns:
        dict: Created settings ID and status

    Raises:
        HTTPException: If creation fails or name already exists
    """
    try:
        settings_dict = settings.model_dump()
        settings_dict["updated_at"] = time.time()  # Add timestamp
        settings_dict["created_at"] = time.time()  # Add creation timestamp
        settings_id = db.add_settings(settings_dict)
        return {"status": "success", "id": settings_id}
    except sqlite3.IntegrityError as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="A settings configuration with this name already exists")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/settings/{settings_id}")
async def update_settings(settings_id: int, settings: SettingsInput):
    """
    Update an existing settings configuration.

    Args:
        settings_id (int): ID of settings to update
        settings (SettingsInput): New settings data

    Returns:
        dict: Operation status
    """
    try:
        settings_dict = settings.model_dump()
        settings_dict["id"] = settings_id
        settings_dict["updated_at"] = time.time()  # Add timestamp
        settings_dict["created_at"] = time.time()  # Add creation timestamp
        success = db.save_settings(settings_dict)
        if not success:
            raise HTTPException(status_code=404, detail="Settings not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/settings/{settings_id}/set_default")
async def set_default_settings(settings_id: int):
    """
    Mark a settings configuration as default.

    Args:
        settings_id (int): ID of settings to mark as default

    Returns:
        dict: Operation status
    """
    try:
        success = db.set_default_settings(settings_id)
        if not success:
            raise HTTPException(status_code=404, detail="Settings not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/settings/all")
async def get_all_settings():
    """
    Get all settings configurations.

    Returns:
        dict: List of all settings configurations
    """
    try:
        settings = db.get_all_settings()
        return {"settings": settings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/settings/{settings_id}")
async def get_settings_by_id(settings_id: int):
    """
    Get settings by ID.

    Args:
        settings_id (int): ID of settings to retrieve

    Returns:
        dict: Settings configuration
    """
    try:
        settings = db.get_settings_by_id(settings_id)
        if not settings:
            raise HTTPException(status_code=404, detail="Settings not found")
        return settings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/default_settings")
async def get_default_values():
    """
    Get default values for a new settings configuration.

    Returns:
        dict: Default settings values
    """
    return {
        "temperature": 1.0,
        "max_tokens": 4096,
        "top_p": 0.95,
        "host": "http://localhost:8000/v1",
        "model_name": "meta-llama/Llama-3.2-1B-Instruct",
        "api_key": "",
    }


def generate_safe_filename(original_filename: str) -> str:
    """
    Generate a safe filename with timestamp to prevent collisions.

    Args:
        original_filename (str): Original filename to be sanitized

    Returns:
        str: Sanitized filename with timestamp
    """
    # Get timestamp
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    # Get file extension
    ext = Path(original_filename).suffix

    # Get base name and sanitize it
    base = Path(original_filename).stem
    # Remove special characters and spaces
    base = re.sub(r"[^\w\-_]", "_", base)

    # Create new filename
    return f"{base}_{timestamp}{ext}"


@app.get("/get_system_prompt", response_class=JSONResponse)
async def get_system_prompt(conversation_id: str = None):
    """
    Get the system prompt for a conversation.

    Args:
        conversation_id (str, optional): ID of the conversation

    Returns:
        JSONResponse: System prompt text

    Raises:
        HTTPException: If retrieval fails
    """
    try:
        if conversation_id:
            history = db.get_conversation_history(conversation_id)
            if history:
                system_role_messages = [m for m in history if m["role"] == "system"]
                last_system_message = (
                    system_role_messages[-1]["content"] if system_role_messages else "You are a helpful assistant."
                )
                return {"system_prompt": last_system_message}

        # Default system prompt for new conversations or when no conversation_id is provided
        active_prompt = db.get_active_prompt()
        return {"system_prompt": active_prompt["prompt_text"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat", response_class=StreamingResponse)
async def chat(
    message: str = Form(...),
    system_prompt: str = Form(...),
    conversation_id: str = Form(...),  # Now required
    client_id: str = Form(...),  # Add client_id parameter
    files: List[UploadFile] = File(None),
    request: Request = None,
):
    """
    Handle chat requests with support for file uploads and streaming responses.

    Args:
        message (str): User's message
        system_prompt (str): System instructions for the AI
        conversation_id (str): Unique identifier for the conversation
        files (List[UploadFile]): Optional list of uploaded files

    Returns:
        StreamingResponse: Server-sent events stream of AI responses

    Raises:
        HTTPException: If there's an error processing the request
    """
    try:
        logger.info(f"Chat request: message='{message}' conv_id={conversation_id} system_prompt='{system_prompt}'")

        # Create new context for this request
        ctx = RequestContext()
        token = request_context.set(ctx)

        try:
            # Verify conversation exists
            history = db.get_conversation_history(conversation_id)
            if history:
                system_role_messages = [m for m in history if m["role"] == "system"]
                last_system_message = system_role_messages[-1]["content"] if system_role_messages else ""
                if last_system_message != system_prompt:
                    db.add_message(conversation_id=conversation_id, role="system", content=system_prompt)

            # Handle multiple file uploads
            file_info_list = []
            if files:
                for file in files:
                    if file is None:
                        continue

                    # Get file size by reading the file into memory
                    contents = await file.read()
                    file_size = len(contents)

                    # Generate safe unique filename
                    safe_filename = generate_safe_filename(file.filename)
                    temp_file = TEMP_DIR / safe_filename

                    try:
                        # Save uploaded file
                        with open(temp_file, "wb") as f:
                            f.write(contents)
                        file_info = {
                            "name": file.filename,  # Original name for display
                            "path": str(temp_file),  # Path to saved file
                            "type": file.content_type,
                            "size": file_size,
                        }
                        file_info_list.append(file_info)
                        logger.info(f"Saved uploaded file: {temp_file} ({file_size} bytes)")
                    except Exception as e:
                        logger.error(f"Failed to save uploaded file: {e}")
                        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")

            if not history:
                db.add_message(conversation_id=conversation_id, role="system", content=system_prompt)

            db.add_message(
                conversation_id=conversation_id,
                role="user",
                content=message,
                attachments=file_info_list if file_info_list else None,
            )

            # get updated conversation history
            history = db.get_conversation_history(conversation_id)

            async def process_and_stream():
                """
                Inner generator function to process the chat and stream responses.

                Yields:
                    str: Chunks of the AI response
                """
                full_response = ""
                if file_info_list:
                    files_str = ", ".join(f"'{f['name']}'" for f in file_info_list)
                    acknowledgment = f"I received your message and the following files: {files_str}\n"
                    full_response += acknowledgment
                    for char in acknowledgment:
                        yield char
                        await asyncio.sleep(0)  # Allow other tasks to run

                try:
                    async for chunk in text_streamer(history, client_id):
                        if ctx.is_disconnected:
                            logger.info("Client disconnected, stopping generation")
                            # Don't save partial response on user-initiated stop
                            return
                        full_response += chunk
                        yield chunk
                        await asyncio.sleep(0)  # Ensure chunks are flushed immediately
                except asyncio.CancelledError:
                    # Request was cancelled, save what we have so far
                    logger.info("Request cancelled by client, saving partial response")
                    if full_response:
                        db.add_message(conversation_id=conversation_id, role="assistant", content=full_response)
                    raise
                except Exception as e:
                    logger.error(f"Error in process_and_stream: {e}")
                    raise

                # Only store complete response if not cancelled
                db.add_message(conversation_id=conversation_id, role="assistant", content=full_response)

                # Broadcast update after storing the response
                await manager.broadcast(
                    {
                        "type": "message_added",
                        "conversation_id": conversation_id,
                    }
                )

                # Generate and store summary after assistant's response but only if its the first user message
                if len(history) == 2 and history[1]["role"] == "user":
                    try:
                        all_user_messages = [m["content"] for m in history if m["role"] == "user"]
                        summary_messages = [
                            {"role": "system", "content": SUMMARY_PROMPT},
                            {"role": "user", "content": str(all_user_messages)},
                        ]
                        summary = ""
                        logger.info(summary_messages)
                        async for chunk in text_streamer(summary_messages, client_id):
                            summary += chunk
                        db.update_conversation_summary(conversation_id, summary.strip())

                        # After summary update
                        await manager.broadcast(
                            {"type": "summary_updated", "conversation_id": conversation_id, "summary": summary.strip()}
                        )
                    except Exception as e:
                        logger.error(f"Failed to generate summary: {e}")

            response = StreamingResponse(
                process_and_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",  # Disable Nginx buffering
                },
            )

            # Set up disconnection detection using response closure
            async def on_disconnect():
                logger.info("Client disconnected, setting disconnected flag")
                ctx.is_disconnected = True

            response.background = on_disconnect
            return response

        finally:
            # Reset context when done
            request_context.reset(token)

    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/regenerate_response", response_class=StreamingResponse)
async def chat_again(
    message: str = Form(...),
    system_prompt: str = Form(...),
    conversation_id: str = Form(...),
    message_id: str = Form(...),
    client_id: str = Form(...),  # Add client_id parameter
):
    """
    This endpoint is used to regenerate the response of a message in a conversation at any point in time.

    Args:
        message (str): User's message
        system_prompt (str): System instructions for the AI
        conversation_id (str): Unique identifier for the conversation
        message_id (str): ID of the message to regenerate. This message will be replaced with the new response.

    Returns:
        StreamingResponse: Server-sent events stream of AI responses

    Raises:
        HTTPException: If there's an error processing the request
    """
    try:
        logger.info(
            f"Regenerate request: message='{message}' conv_id={conversation_id} system_prompt='{system_prompt}'"
        )

        # Verify conversation exists
        history = db.get_conversation_history_upto_message_id(conversation_id, message_id)
        logger.info(history)

        if not history:
            logger.error("No conversation history found")
            raise HTTPException(status_code=404, detail="No conversation history found")

        system_role_messages = [m for m in history if m["role"] == "system"]
        last_system_message = system_role_messages[-1]["content"] if system_role_messages else ""
        if last_system_message != system_prompt:
            db.add_message(conversation_id=conversation_id, role="system", content=system_prompt)

        async def process_and_stream():
            """
            Inner generator function to process the chat and stream responses.

            Yields:
                str: Chunks of the AI response
            """
            full_response = ""
            async for chunk in text_streamer(history, client_id):
                full_response += chunk
                yield chunk
                await asyncio.sleep(0)  # Ensure chunks are flushed immediately

            # Store the complete response
            db.edit_message(message_id, full_response)

            # Broadcast update after storing the response
            await manager.broadcast(
                {
                    "type": "message_added",
                    "conversation_id": conversation_id,
                }
            )

        return StreamingResponse(
            process_and_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable Nginx buffering
            },
        )

    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/conversations/{conversation_id}/summary")
async def update_conversation_summary(conversation_id: str, summary: str = Form(...)):
    """
    Update the summary of a conversation.

    Args:
        conversation_id (str): ID of the conversation
        summary (str): New summary text

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If update fails
    """
    try:
        db.update_conversation_summary(conversation_id, summary)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/prompts")
async def get_all_prompts():
    """Get all system prompts."""
    try:
        prompts = db.get_all_prompts()
        formatted_prompts = []
        for prompt in prompts:
            formatted_prompts.append(
                {
                    "id": prompt["id"],
                    "name": prompt["prompt_name"],
                    "content": prompt["prompt_text"],
                    "is_active": bool(prompt["is_active"]),  # Ensure boolean type
                }
            )
        return {"prompts": formatted_prompts}
    except Exception as e:
        logger.error(f"Error getting prompts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/prompts/{prompt_id}")
async def get_prompt(prompt_id: int):
    """Get a specific prompt."""
    try:
        prompt = db.get_prompt_by_id(prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {
            "id": prompt["id"],  # Changed from tuple index to dict key
            "name": prompt["prompt_name"],
            "content": prompt["prompt_text"],
        }
    except Exception as e:
        logger.error(f"Error getting prompt {prompt_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/prompts")
async def create_prompt(prompt: PromptInput):
    """Create a new prompt."""
    try:
        prompt_id = db.add_system_prompt(prompt.name, prompt.text)
        return {"id": prompt_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/prompts/{prompt_id}")
async def update_prompt(prompt_id: int, prompt: PromptInput):
    """Update an existing prompt."""
    try:
        success = db.edit_system_prompt(prompt_id, prompt.name, prompt.text)
        if not success:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/prompts/{prompt_id}")
async def delete_prompt(prompt_id: int):
    """
    Delete a system prompt.

    Args:
        prompt_id (int): ID of the prompt to delete

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If deletion fails or prompt is protected
    """
    try:
        # Get prompt to check if it's the default one
        prompt = db.get_prompt_by_id(prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="Prompt not found")

        if prompt["prompt_name"] == "default":
            raise HTTPException(status_code=403, detail="Cannot delete the default prompt")

        success = db.delete_system_prompt(prompt_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete prompt")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/prompts/{prompt_id}/activate")
async def activate_prompt(prompt_id: int):
    """
    Set a prompt as the active system prompt.

    Args:
        prompt_id (int): ID of the prompt to activate

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If activation fails or prompt not found
    """
    try:
        success = db.set_active_prompt(prompt_id)
        if not success:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/prompts/active")
async def get_active_prompt():
    """Get the currently active system prompt."""
    try:
        prompt = db.get_active_prompt()
        if not prompt:
            # If no active prompt, get default
            prompt = db.get_prompt_by_name("default")
            if prompt:
                # Make default prompt active
                db.set_active_prompt(prompt["id"])

        if not prompt:
            raise HTTPException(status_code=404, detail="No active or default prompt found")

        return {"id": prompt["id"], "name": prompt["prompt_name"], "content": prompt["prompt_text"]}
    except Exception as e:
        logger.error(f"Error getting active prompt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "stop_generation":
                manager.set_generating(client_id, False)
                logger.info(f"Received stop signal for client {client_id}")
            else:
                # Handle other WebSocket messages
                pass
    except WebSocketDisconnect:
        manager.disconnect(client_id)
