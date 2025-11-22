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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
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


class ProviderInput(BaseModel):
    """
    Pydantic model for provider configuration.

    Attributes:
        name (str): Name of the provider
        temperature (float): Controls randomness in responses
        max_tokens (int): Maximum length of generated responses
        top_p (float): Controls diversity via nucleus sampling
        host (str): API endpoint URL
        api_key (str): Authentication key for the API
        is_multimodal (bool): Whether the provider supports file uploads
    """

    name: str
    temperature: Optional[float] = 1.0
    max_tokens: Optional[int] = 4096
    top_p: Optional[float] = 0.95
    host: str
    api_key: Optional[str] = ""


class ModelInput(BaseModel):
    """
    Pydantic model for model input.

    Attributes:
        model_name (str): Name of the model
    """

    model_name: str
    is_multimodal: Optional[bool] = False


class PromptInput(BaseModel):
    """
    Pydantic model for system prompt input.

    Attributes:
        name (str): Name of the prompt
        text (str): The prompt text content
    """

    name: str
    text: str


class ProjectInput(BaseModel):
    """
    Pydantic model for project input.

    Attributes:
        name (str): Project name
        description (str): Project description
        system_prompt (str): Default system prompt for the project
    """

    name: str
    description: Optional[str] = ""
    system_prompt: Optional[str] = ""


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
    # Get default provider and model
    provider = db.get_default_provider()
    if not provider:
        raise HTTPException(status_code=404, detail="No default provider found")

    default_model = db.get_default_model(provider["id"])
    if not default_model:
        raise HTTPException(status_code=404, detail="No default model found for provider")

    client = OpenAI(
        api_key=provider["api_key"] if provider["api_key"] != "" else "empty",
        base_url=provider["host"],
    )

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
                file_path = att["file_path"]
                mime_type = att.get("file_type", "application/octet-stream")

                # For all file types, encode as base64 and let the API handle it
                with open(file_path, "rb") as f:
                    file_data = base64.b64encode(f.read()).decode()

                # Handle different file types
                if file_type == "image":
                    content.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{file_data}"}})
                elif file_type == "video":
                    content.append({"type": "video_url", "video_url": {"url": f"data:{mime_type};base64,{file_data}"}})
                elif file_type == "audio":
                    content.append(
                        {"type": "input_audio", "input_audio": {"url": f"data:{mime_type};base64,{file_data}"}}
                    )
                else:
                    # For documents (PDF, etc), send as image_url with proper MIME type
                    # Many APIs support this for document understanding
                    content.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{file_data}"}})

            formatted_msg["content"] = content
        else:
            # Handle text-only messages
            formatted_msg["content"] = msg["content"]

        formatted_messages.append(formatted_msg)

    stream = None
    try:
        manager.set_generating(client_id, True)
        stream = client.chat.completions.create(
            messages=formatted_messages,
            model=default_model["model_name"],
            max_completion_tokens=provider["max_tokens"],
            temperature=provider["temperature"],
            top_p=provider["top_p"],
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
async def get_conversations(project_id: Optional[str] = None):
    """
    Retrieve all conversations.

    Args:
        project_id (str, optional): Filter by project ID

    Returns:
        dict: List of all conversations

    Raises:
        HTTPException: If database operation fails
    """
    try:
        conversations = db.get_all_conversations(project_id)
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


class CreateConversationInput(BaseModel):
    project_id: Optional[str] = None


@app.post("/create_conversation")
async def create_conversation(input: Optional[CreateConversationInput] = None):
    """
    Create a new conversation.

    Returns:
        dict: New conversation ID

    Raises:
        HTTPException: If creation fails
    """
    try:
        project_id = input.project_id if input else None
        conversation_id = db.create_conversation(project_id)
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


class ConversationTitleUpdate(BaseModel):
    """Model for updating conversation title."""

    title: str


@app.put("/conversations/{conversation_id}/title")
async def update_conversation_title(conversation_id: str, update: ConversationTitleUpdate):
    """
    Update a conversation's title/summary.

    Args:
        conversation_id (str): ID of conversation to update
        update (ConversationTitleUpdate): New title

    Returns:
        dict: Operation status

    Raises:
        HTTPException: If update fails
    """
    try:
        db.update_conversation_summary(conversation_id, update.title)
        await manager.broadcast(
            {"type": "summary_updated", "conversation_id": conversation_id, "summary": update.title}
        )
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Provider endpoints
@app.get("/providers")
async def get_all_providers():
    """Get all providers."""
    try:
        providers = db.get_all_providers()
        return {"providers": providers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/providers/{provider_id}")
async def get_provider(provider_id: int):
    """Get provider by ID."""
    try:
        provider = db.get_provider_by_id(provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        return provider
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/providers")
async def create_provider(provider: ProviderInput):
    """Create a new provider."""
    try:
        provider_dict = provider.model_dump()
        provider_id = db.add_provider(provider_dict)
        return {"status": "success", "id": provider_id}
    except sqlite3.IntegrityError as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="A provider with this name already exists")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/providers/{provider_id}")
async def update_provider(provider_id: int, provider: ProviderInput):
    """Update a provider."""
    try:
        provider_dict = provider.model_dump()
        success = db.update_provider(provider_id, provider_dict)
        if not success:
            raise HTTPException(status_code=404, detail="Provider not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/providers/{provider_id}")
async def delete_provider(provider_id: int):
    """Delete a provider."""
    try:
        success = db.delete_provider(provider_id)
        if not success:
            raise HTTPException(status_code=404, detail="Provider not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/providers/{provider_id}/set_default")
async def set_default_provider(provider_id: int):
    """Set a provider as default."""
    try:
        success = db.set_default_provider(provider_id)
        if not success:
            raise HTTPException(status_code=404, detail="Provider not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Model endpoints
@app.get("/providers/{provider_id}/models")
async def get_provider_models(provider_id: int):
    """Get all models for a provider."""
    try:
        models = db.get_models_by_provider(provider_id)
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/providers/{provider_id}/models")
async def add_provider_model(provider_id: int, model: ModelInput):
    """Add a model to a provider."""
    try:
        model_id = db.add_model(provider_id, model.model_name, is_multimodal=model.is_multimodal)
        return {"status": "success", "id": model_id}
    except sqlite3.IntegrityError as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="This model already exists for this provider")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/models/{model_id}")
async def delete_model(model_id: int):
    """Delete a model."""
    try:
        success = db.delete_model(model_id)
        if not success:
            raise HTTPException(status_code=404, detail="Model not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/models/{model_id}/set_default")
async def set_default_model(model_id: int):
    """Set a model as default for its provider."""
    try:
        success = db.set_default_model(model_id)
        if not success:
            raise HTTPException(status_code=404, detail="Model not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/default_provider")
async def get_default_provider():
    """Get the default provider."""
    try:
        provider = db.get_default_provider()
        if not provider:
            raise HTTPException(status_code=404, detail="No default provider found")
        return provider
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Project endpoints
@app.get("/projects")
async def get_projects():
    """Get all projects."""
    try:
        projects = db.get_projects()
        return {"projects": projects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/projects/{project_id}")
async def get_project(project_id: str):
    """Get project by ID."""
    try:
        project = db.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return project
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects")
async def create_project(project: ProjectInput):
    """Create a new project."""
    try:
        project_id = db.create_project(
            name=project.name,
            description=project.description,
            system_prompt=project.system_prompt
        )
        return {"status": "success", "id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/projects/{project_id}")
async def update_project(project_id: str, project: ProjectInput):
    """Update a project."""
    try:
        success = db.update_project(
            project_id=project_id,
            name=project.name,
            description=project.description,
            system_prompt=project.system_prompt
        )
        if not success:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project."""
    try:
        success = db.delete_project(project_id)
        if not success:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        # If conversation_id is provided, check its project
        if conversation_id:
            project = db.get_project_for_conversation(conversation_id)
            if project and project.get("system_prompt"):
                return {"system_prompt": project["system_prompt"]}

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

                    # Try to read file content if it's text
                    try:
                        with open(temp_file, "r", encoding="utf-8") as f:
                            text_content = f.read()
                            # Append text content to message
                            message += f"\n\n--- File: {file.filename} ---\n{text_content}"
                    except UnicodeDecodeError:
                        # Not a text file, skip appending content
                        pass
                    except Exception as e:
                        logger.warning(f"Failed to read file content: {e}")

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

                # Removed canned response generator

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
                message_id = db.add_message(conversation_id=conversation_id, role="assistant", content=full_response)

                # Broadcast update after storing the response
                await manager.broadcast(
                    {
                        "type": "message_added",
                        "conversation_id": conversation_id,
                        "message_id": message_id,
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


@app.get("/attachments/{attachment_id}")
async def get_attachment(attachment_id: str):
    """Serve attachment files."""
    attachment = db.get_attachment(attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = Path(attachment["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, filename=attachment["file_name"], media_type=attachment["file_type"])
