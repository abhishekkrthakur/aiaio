import os
import sqlite3
import time
import uuid
from typing import Dict, List, Optional

from .prompts import SYSTEM_PROMPTS


# SQL schema for creating database tables
_DB = """
CREATE TABLE conversations (
    conversation_id TEXT PRIMARY KEY,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now')),
    last_updated REAL DEFAULT (strftime('%s.%f', 'now')),
    summary TEXT,
    project_id TEXT REFERENCES projects(project_id)
);

CREATE TABLE messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT,
    role TEXT CHECK(role IN ('user', 'assistant', 'system')),
    content_type TEXT CHECK(content_type IN ('text', 'image', 'audio', 'video', 'file')),
    content TEXT,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE TABLE attachments (
    attachment_id TEXT PRIMARY KEY,
    message_id TEXT,
    file_name TEXT,
    file_path TEXT,
    file_type TEXT,
    file_size INTEGER,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now')),
    FOREIGN KEY (message_id) REFERENCES messages(message_id)
);

CREATE TABLE providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    temperature REAL DEFAULT 1.0,
    max_tokens INTEGER DEFAULT 4096,
    top_p REAL DEFAULT 0.95,
    host TEXT NOT NULL,
    api_key TEXT DEFAULT '',
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now'))
);

CREATE TABLE models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    is_multimodal BOOLEAN DEFAULT false,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now')),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    UNIQUE(provider_id, model_name)
);

CREATE TABLE system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_name TEXT NOT NULL UNIQUE,
    prompt_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now'))
);

CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now'))
);
"""


class ChatDatabase:
    """A class to manage chat-related database operations.

    This class handles all database interactions for conversations, messages,
    attachments, and settings using SQLite.

    Attributes:
        db_path (str): Path to the SQLite database file
    """

    def __init__(self, db_path: str = "chatbot.db"):
        """Initialize the database connection.

        Args:
            db_path (str, optional): Path to the SQLite database file. Defaults to "chatbot.db".
        """
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the database schema.

        Creates tables if they don't exist or if the database is new.
        Also handles schema migrations for existing databases.
        """
        db_exists = os.path.exists(self.db_path)

        with sqlite3.connect(self.db_path) as conn:
            if not db_exists:
                # Execute schema
                conn.executescript(_DB)

                # Insert default providers and models
                providers_count = conn.execute("SELECT COUNT(*) FROM providers").fetchone()[0]
                if providers_count == 0:
                    # Local provider
                    cursor = conn.execute(
                        """INSERT INTO providers
                           (name, is_default, temperature, max_tokens, top_p, host, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        ("Custom", True, 1.0, 4096, 0.95, "http://localhost:8000/v1", ""),
                    )
                    local_id = cursor.lastrowid
                    conn.execute(
                        "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                        (local_id, "meta-llama/Llama-3.2-1B-Instruct", True, False),
                    )

                    # OpenAI provider
                    cursor = conn.execute(
                        """INSERT INTO providers
                           (name, is_default, temperature, max_tokens, top_p, host, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        ("OpenAI", False, 1.0, 4096, 0.95, "https://api.openai.com/v1", ""),
                    )
                    openai_id = cursor.lastrowid
                    conn.execute(
                        "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                        (openai_id, "gpt-4o", True, True),
                    )
                    conn.execute(
                        "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                        (openai_id, "gpt-4o-mini", False, True),
                    )

                    # Anthropic provider
                    cursor = conn.execute(
                        """INSERT INTO providers
                           (name, is_default, temperature, max_tokens, top_p, host, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        ("Anthropic", False, 1.0, 4096, 0.95, "https://api.anthropic.com/v1", ""),
                    )
                    anthropic_id = cursor.lastrowid
                    conn.execute(
                        "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                        (anthropic_id, "claude-3-5-sonnet-latest", True, True),
                    )

                    # Google provider
                    cursor = conn.execute(
                        """INSERT INTO providers
                           (name, is_default, temperature, max_tokens, top_p, host, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        ("Google", False, 1.0, 4096, 0.95, "https://generativelanguage.googleapis.com/v1beta", ""),
                    )
                    google_id = cursor.lastrowid
                    conn.execute(
                        "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                        (google_id, "gemini-2.0-flash-001", True, True),
                    )

                # Insert system prompts
                conn.execute(
                    """INSERT INTO system_prompts (prompt_name, prompt_text, is_active)
                       VALUES (?, ?, ?)""",
                    ("summary", SYSTEM_PROMPTS["summary"].strip(), False),
                )
                conn.execute(
                    """INSERT INTO system_prompts (prompt_name, prompt_text, is_active)
                       VALUES (?, ?, ?)""",
                    ("default", SYSTEM_PROMPTS["default"].strip(), True),
                )
            else:
                # Check if summary column exists
                columns = conn.execute("PRAGMA table_info(conversations)").fetchall()
                column_names = [col[1] for col in columns]
                if "summary" not in column_names:
                    conn.execute("ALTER TABLE conversations ADD COLUMN summary TEXT")
                
                # Check if project_id column exists
                if "project_id" not in column_names:
                    conn.execute("ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(project_id)")

            # Ensure default project exists
            projects_count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
            if projects_count == 0:
                default_project_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO projects (project_id, name, description, system_prompt) VALUES (?, ?, ?, ?)",
                    (default_project_id, "General", "Default project for general conversations", SYSTEM_PROMPTS["default"].strip())
                )
                
                # Migrate existing conversations to default project
                conn.execute(
                    "UPDATE conversations SET project_id = ? WHERE project_id IS NULL",
                    (default_project_id,)
                )

    def create_conversation(self, project_id: Optional[str] = None) -> str:
        """Create a new conversation.

        Args:
            project_id (str, optional): ID of the project the conversation belongs to.

        Returns:
            str: Unique identifier for the created conversation.
        """
        conversation_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as conn:
            if project_id:
                conn.execute(
                    "INSERT INTO conversations (conversation_id, project_id) VALUES (?, ?)",
                    (conversation_id, project_id)
                )
            else:
                # Fallback to default project if none specified
                # Find a default project or the first one
                project = conn.execute("SELECT project_id FROM projects ORDER BY created_at ASC LIMIT 1").fetchone()
                if project:
                    conn.execute(
                        "INSERT INTO conversations (conversation_id, project_id) VALUES (?, ?)",
                        (conversation_id, project[0])
                    )
                else:
                    # Should not happen due to init_db, but safe fallback
                    conn.execute("INSERT INTO conversations (conversation_id) VALUES (?)", (conversation_id,))
        return conversation_id

    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        content_type: str = "text",
        attachments: Optional[List[Dict]] = None,
    ) -> str:
        """Add a new message to a conversation.

        Args:
            conversation_id (str): ID of the conversation
            role (str): Role of the message sender ('user', 'assistant', or 'system')
            content (str): Content of the message
            content_type (str, optional): Type of content. Defaults to "text".
            attachments (Optional[List[Dict]], optional): List of attachment metadata. Defaults to None.

        Returns:
            str: Unique identifier for the created message
        """
        message_id = str(uuid.uuid4())
        current_time = time.time()

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO messages
                   (message_id, conversation_id, role, content_type, content, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (message_id, conversation_id, role, content_type, content, current_time),
            )

            conn.execute(
                """UPDATE conversations
                   SET last_updated = ?
                   WHERE conversation_id = ?""",
                (current_time, conversation_id),
            )

            if attachments:
                for att in attachments:
                    conn.execute(
                        """INSERT INTO attachments
                           (attachment_id, message_id, file_name, file_path, file_type, file_size, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            str(uuid.uuid4()),
                            message_id,
                            att["name"],
                            att["path"],
                            att["type"],
                            att["size"],
                            current_time,
                        ),
                    )

        return message_id

    def get_conversation_history(self, conversation_id: str) -> List[Dict]:
        """Retrieve the full history of a conversation including attachments.

        Args:
            conversation_id (str): ID of the conversation

        Returns:
            List[Dict]: List of messages with their attachments in chronological order
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            messages = conn.execute(
                """SELECT m.*, a.attachment_id, a.file_name, a.file_path, a.file_type, a.file_size
                   FROM messages m
                   LEFT JOIN attachments a ON m.message_id = a.message_id
                   WHERE m.conversation_id = ?
                   ORDER BY m.created_at ASC""",
                (conversation_id,),
            ).fetchall()

        # Group attachments by message_id
        message_dict = {}
        for row in messages:
            message_id = row["message_id"]
            if message_id not in message_dict:
                message_dict[message_id] = {
                    key: row[key]
                    for key in ["message_id", "conversation_id", "role", "content_type", "content", "created_at"]
                }
                message_dict[message_id]["attachments"] = []

            if row["attachment_id"]:
                message_dict[message_id]["attachments"].append(
                    {
                        "attachment_id": row["attachment_id"],
                        "file_name": row["file_name"],
                        "file_path": row["file_path"],
                        "file_type": row["file_type"],
                        "file_size": row["file_size"],
                    }
                )

        return list(message_dict.values())

    def get_attachment(self, attachment_id: str) -> Optional[Dict]:
        """Retrieve attachment details by ID."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM attachments WHERE attachment_id = ?", (attachment_id,)).fetchone()
            if row:
                return dict(row)
            return None

    def get_conversation_history_upto_message_id(self, conversation_id: str, message_id: str) -> List[Dict]:
        """Retrieve the full history of a conversation including attachments up to but not including a message_id.

        Args:
            conversation_id (str): ID of the conversation
            message_id (str): ID of the message

        Returns:
            List[Dict]: List of messages with their attachments in chronological order
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            messages = conn.execute(
                """SELECT m.*, a.attachment_id, a.file_name, a.file_path, a.file_type, a.file_size
                   FROM messages m
                   LEFT JOIN attachments a ON m.message_id = a.message_id
                   WHERE m.conversation_id = ? AND m.created_at < (
                       SELECT created_at FROM messages WHERE message_id = ?
                   )
                   ORDER BY m.created_at ASC""",
                (conversation_id, message_id),
            ).fetchall()

        # Group attachments by message_id
        message_dict = {}
        for row in messages:
            message_id = row["message_id"]
            if message_id not in message_dict:
                message_dict[message_id] = {
                    key: row[key]
                    for key in ["message_id", "conversation_id", "role", "content_type", "content", "created_at"]
                }
                message_dict[message_id]["attachments"] = []

            if row["attachment_id"]:
                message_dict[message_id]["attachments"].append(
                    {
                        "attachment_id": row["attachment_id"],
                        "file_name": row["file_name"],
                        "file_path": row["file_path"],
                        "file_type": row["file_type"],
                        "file_size": row["file_size"],
                    }
                )

        return list(message_dict.values())

    def delete_conversation(self, conversation_id: str):
        """Delete a conversation and all its associated messages and attachments.

        Args:
            conversation_id (str): ID of the conversation to delete
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """DELETE FROM attachments
                   WHERE message_id IN (
                       SELECT message_id FROM messages WHERE conversation_id = ?
                   )""",
                (conversation_id,),
            )
            conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
            conn.execute("DELETE FROM conversations WHERE conversation_id = ?", (conversation_id,))

    def get_all_conversations(self, project_id: Optional[str] = None) -> List[Dict]:
        """Retrieve all conversations with their message counts and last activity.

        Args:
            project_id (str, optional): Filter by project ID.

        Returns:
            List[Dict]: List of conversations with their metadata
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            
            query = """SELECT c.*,
                   COUNT(m.message_id) as message_count,
                   MAX(m.created_at) as last_message_at
                   FROM conversations c
                   LEFT JOIN messages m ON c.conversation_id = m.conversation_id"""
            
            params = []
            if project_id:
                query += " WHERE c.project_id = ?"
                params.append(project_id)
                
            query += """ GROUP BY c.conversation_id
                   ORDER BY c.created_at ASC"""
            
            conversations = conn.execute(query, tuple(params)).fetchall()

        return [dict(conv) for conv in conversations]

    def get_project_for_conversation(self, conversation_id: str) -> Optional[Dict]:
        """Get the project associated with a conversation.

        Args:
            conversation_id (str): ID of the conversation

        Returns:
            Optional[Dict]: Project data if found, None otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            project = conn.execute(
                """SELECT p.* FROM projects p
                   JOIN conversations c ON p.project_id = c.project_id
                   WHERE c.conversation_id = ?""",
                (conversation_id,)
            ).fetchone()
            return dict(project) if project else None

    # Project CRUD methods
    def create_project(self, name: str, description: str = "", system_prompt: str = "") -> str:
        """Create a new project.

        Args:
            name (str): Project name
            description (str): Project description
            system_prompt (str): Default system prompt for the project

        Returns:
            str: Project ID
        """
        project_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO projects (project_id, name, description, system_prompt)
                   VALUES (?, ?, ?, ?)""",
                (project_id, name, description, system_prompt)
            )
        return project_id

    def get_projects(self) -> List[Dict]:
        """Get all projects."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            projects = conn.execute("SELECT * FROM projects ORDER BY created_at ASC").fetchall()
            return [dict(p) for p in projects]

    def get_project(self, project_id: str) -> Optional[Dict]:
        """Get a project by ID."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            project = conn.execute("SELECT * FROM projects WHERE project_id = ?", (project_id,)).fetchone()
            return dict(project) if project else None

    def update_project(self, project_id: str, name: str, description: str, system_prompt: str) -> bool:
        """Update a project."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """UPDATE projects
                   SET name = ?, description = ?, system_prompt = ?, updated_at = strftime('%s.%f', 'now')
                   WHERE project_id = ?""",
                (name, description, system_prompt, project_id)
            )
            return cursor.rowcount > 0

    def delete_project(self, project_id: str) -> bool:
        """Delete a project and its conversations."""
        with sqlite3.connect(self.db_path) as conn:
            # Delete messages for all conversations in project
            conn.execute(
                """DELETE FROM messages WHERE conversation_id IN 
                   (SELECT conversation_id FROM conversations WHERE project_id = ?)""",
                (project_id,)
            )
            # Delete conversations
            conn.execute("DELETE FROM conversations WHERE project_id = ?", (project_id,))
            # Delete project
            cursor = conn.execute("DELETE FROM projects WHERE project_id = ?", (project_id,))
            return cursor.rowcount > 0

    # Provider CRUD methods
    def get_default_provider(self) -> Optional[Dict]:
        """Get the default provider with its settings."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            provider = conn.execute("SELECT * FROM providers WHERE is_default = true").fetchone()
            return dict(provider) if provider else None

    def get_all_providers(self) -> List[Dict]:
        """Get all providers."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            providers = conn.execute("SELECT * FROM providers ORDER BY name").fetchall()
            return [dict(p) for p in providers]

    def get_provider_by_id(self, provider_id: int) -> Optional[Dict]:
        """Get provider by ID."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            provider = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
            return dict(provider) if provider else None

    def add_provider(self, provider: Dict) -> int:
        """Add a new provider."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """INSERT INTO providers
                   (name, temperature, max_tokens, top_p, host, api_key)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    provider.get("name"),
                    provider.get("temperature", 1.0),
                    provider.get("max_tokens", 4096),
                    provider.get("top_p", 0.95),
                    provider.get("host"),
                    provider.get("api_key", ""),
                ),
            )
            return cursor.lastrowid

    def update_provider(self, provider_id: int, provider: Dict) -> bool:
        """Update provider settings."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """UPDATE providers
                   SET name = ?, temperature = ?, max_tokens = ?, top_p = ?,
                       host = ?, api_key = ?, updated_at = strftime('%s.%f', 'now')
                   WHERE id = ?""",
                (
                    provider.get("name"),
                    provider.get("temperature", 1.0),
                    provider.get("max_tokens", 4096),
                    provider.get("top_p", 0.95),
                    provider.get("host"),
                    provider.get("api_key", ""),
                    provider_id,
                ),
            )
            return cursor.rowcount > 0

    def delete_provider(self, provider_id: int) -> bool:
        """Delete a provider (cascade deletes models)."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
            return cursor.rowcount > 0

    def set_default_provider(self, provider_id: int) -> bool:
        """Set a provider as default."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE providers SET is_default = false WHERE is_default = true")
            cursor = conn.execute("UPDATE providers SET is_default = true WHERE id = ?", (provider_id,))
            return cursor.rowcount > 0

    # Model CRUD methods
    def get_models_by_provider(self, provider_id: int) -> List[Dict]:
        """Get all models for a provider."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            models = conn.execute(
                "SELECT * FROM models WHERE provider_id = ? ORDER BY is_default DESC, model_name", (provider_id,)
            ).fetchall()
            return [dict(m) for m in models]

    def get_default_model(self, provider_id: int) -> Optional[Dict]:
        """Get the default model for a provider."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            model = conn.execute(
                "SELECT * FROM models WHERE provider_id = ? AND is_default = true", (provider_id,)
            ).fetchone()
            return dict(model) if model else None

    def add_model(
        self, provider_id: int, model_name: str, is_default: bool = False, is_multimodal: bool = False
    ) -> int:
        """Add a model to a provider."""
        with sqlite3.connect(self.db_path) as conn:
            # Check if this is the first model for the provider
            existing_models = conn.execute(
                "SELECT COUNT(*) FROM models WHERE provider_id = ?", (provider_id,)
            ).fetchone()[0]

            # If this is the first model, make it default automatically
            if existing_models == 0:
                is_default = True

            # If setting as default, unset other defaults for this provider
            if is_default:
                conn.execute(
                    "UPDATE models SET is_default = false WHERE provider_id = ? AND is_default = true", (provider_id,)
                )

            cursor = conn.execute(
                "INSERT INTO models (provider_id, model_name, is_default, is_multimodal) VALUES (?, ?, ?, ?)",
                (provider_id, model_name, is_default, is_multimodal),
            )
            return cursor.lastrowid

    def delete_model(self, model_id: int) -> bool:
        """Delete a model."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM models WHERE id = ?", (model_id,))
            return cursor.rowcount > 0

    def set_default_model(self, model_id: int) -> bool:
        """Set a model as default for its provider."""
        with sqlite3.connect(self.db_path) as conn:
            # Get provider_id for this model
            provider_id = conn.execute("SELECT provider_id FROM models WHERE id = ?", (model_id,)).fetchone()
            if not provider_id:
                return False

            # Unset other defaults for this provider
            conn.execute(
                "UPDATE models SET is_default = false WHERE provider_id = ? AND is_default = true", (provider_id[0],)
            )

            # Set this model as default
            cursor = conn.execute("UPDATE models SET is_default = true WHERE id = ?", (model_id,))
            return cursor.rowcount > 0

    def update_conversation_summary(self, conversation_id: str, summary: str):
        """Update the summary of a conversation.

        Args:
            conversation_id (str): ID of the conversation
            summary (str): New summary text for the conversation
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """UPDATE conversations
                   SET summary = ?, updated_at = strftime('%s.%f', 'now')
                   WHERE conversation_id = ?""",
                (summary, conversation_id),
            )

    def add_system_prompt(self, name: str, text: str) -> int:
        """Add a new system prompt.

        Args:
            name (str): Name of the prompt
            text (str): Prompt text

        Returns:
            int: ID of the newly created prompt
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("INSERT INTO system_prompts (prompt_name, prompt_text) VALUES (?, ?)", (name, text))
            return cursor.lastrowid

    def edit_system_prompt(self, prompt_id: int, name: str, text: str) -> bool:
        """Edit an existing system prompt.

        Args:
            prompt_id (int): ID of the prompt to edit
            name (str): New name for the prompt
            text (str): New prompt text

        Returns:
            bool: True if successful, False otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """UPDATE system_prompts
                   SET prompt_name = ?,
                       prompt_text = ?,
                       updated_at = strftime('%s.%f', 'now')
                   WHERE id = ?""",
                (name, text, prompt_id),
            )
            return cursor.rowcount > 0

    def set_active_prompt(self, prompt_id: int) -> bool:
        """Set a prompt as active and deactivate all others.

        Args:
            prompt_id (int): ID of the prompt to activate

        Returns:
            bool: True if successful, False otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE system_prompts SET is_active = false")
            cursor = conn.execute("UPDATE system_prompts SET is_active = true WHERE id = ?", (prompt_id,))
            return cursor.rowcount > 0

    def get_active_prompt(self) -> Optional[Dict]:
        """Get the currently active system prompt.

        Returns:
            Optional[Dict]: Active prompt data if found, None otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            prompt = conn.execute("SELECT * FROM system_prompts WHERE is_active = true").fetchone()
            return dict(prompt) if prompt else None

    def get_all_prompts(self) -> List[Dict]:
        """Get all system prompts.

        Returns:
            List[Dict]: List of all prompts
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            prompts = conn.execute("SELECT * FROM system_prompts").fetchall()
            return [dict(prompt) for prompt in prompts]

    def get_prompt_by_id(self, prompt_id: int) -> Optional[Dict]:
        """Get a specific system prompt by ID.

        Args:
            prompt_id (int): ID of the prompt to retrieve

        Returns:
            Optional[Dict]: Prompt data if found, None otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            prompt = conn.execute("SELECT * FROM system_prompts WHERE id = ?", (prompt_id,)).fetchone()
            return dict(prompt) if prompt else None

    def delete_system_prompt(self, prompt_id: int) -> bool:
        """Delete a system prompt.

        Args:
            prompt_id (int): ID of the prompt to delete

        Returns:
            bool: True if successful, False otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM system_prompts WHERE id = ? AND prompt_name != 'default'", (prompt_id,))
            return cursor.rowcount > 0

    def edit_message(self, message_id: str, new_content: str) -> bool:
        """Edit an existing message's content.

        Args:
            message_id (str): ID of the message to edit
            new_content (str): New message content

        Returns:
            bool: True if successful, False if message not found

        Raises:
            ValueError: If trying to edit a system message
        """
        with sqlite3.connect(self.db_path) as conn:
            # Check if message exists and isn't a system message
            message = conn.execute("SELECT role FROM messages WHERE message_id = ?", (message_id,)).fetchone()

            if not message:
                return False

            if message[0] == "system":
                raise ValueError("System messages cannot be edited")

            cursor = conn.execute(
                """UPDATE messages
                   SET content = ?, updated_at = strftime('%s.%f', 'now')
                   WHERE message_id = ?""",
                (new_content, message_id),
            )
            return cursor.rowcount > 0
