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
    summary TEXT
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

CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    "default" BOOLEAN NOT NULL DEFAULT false,
    temperature REAL DEFAULT 1.0,
    max_tokens INTEGER DEFAULT 4096,
    top_p REAL DEFAULT 0.95,
    host TEXT DEFAULT 'http://localhost:8000/v1',
    model_name TEXT DEFAULT 'meta-llama/Llama-3.2-1B-Instruct',
    api_key TEXT DEFAULT '',
    created_at REAL DEFAULT (strftime('%s.%f', 'now')),
    updated_at REAL DEFAULT (strftime('%s.%f', 'now'))
);

CREATE TABLE system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_name TEXT NOT NULL UNIQUE,
    prompt_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
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

                # Insert default settings only if no settings exist
                settings_count = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
                if settings_count == 0:
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "default",
                            True,
                            1.0,
                            4096,
                            0.95,
                            "http://localhost:8000/v1",
                            "meta-llama/Llama-3.2-1B-Instruct",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "HF: SambaNova",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://router.huggingface.co/sambanova",
                            "meta-llama/Llama-3.2-1B-Instruct",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "HF: Inference API",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://router.huggingface.co/hf-inference/v1",
                            "meta-llama/Llama-3.2-1B-Instruct",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "OpenAI",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://router.huggingface.co/hf-inference/v2",
                            "o3-mini-2025-01-31",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "Anthropic",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://api.anthropic.com/v1",
                            "claude-3-5-sonnet-latest",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "DeepSeek",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://api.deepseek.com/v1",
                            "deepseek-chat",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "Mistral",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://api.mistral.ai/v1",
                            "mistral-large-latest",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "Google",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://generativelanguage.googleapis.com/v1beta",
                            "gemini-2.0-flash-001",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "XAI",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://api.x.ai/v1",
                            "grok-2-1212",
                            "",
                        ),
                    )
                    conn.execute(
                        """INSERT INTO settings
                           (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            "Arcee AI",
                            False,
                            1.0,
                            4096,
                            0.95,
                            "https://models.arcee.ai/v1",
                            "auto",
                            "",
                        ),
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
                # Check if tables exist and create if missing
                tables = conn.execute(
                    """SELECT name FROM sqlite_master
                       WHERE type='table' AND
                       name IN ('conversations', 'messages', 'attachments', 'settings', 'system_prompts')"""
                ).fetchall()
                existing_tables = [table[0] for table in tables]

                if len(existing_tables) < 5:
                    missing_tables = _DB.split(";")
                    for create_stmt in missing_tables:
                        if create_stmt.strip():
                            # Extract table name from CREATE TABLE statement
                            table_name = create_stmt.split("CREATE TABLE")[1].split("(")[0].strip()
                            if table_name not in existing_tables:
                                conn.execute(create_stmt)

                    # Insert default settings if settings table was just created
                    if "settings" not in existing_tables:
                        settings_count = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
                        if settings_count == 0:
                            conn.execute(
                                """INSERT INTO settings
                                   (name, "default", temperature, max_tokens, top_p, host, model_name, api_key)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                                (
                                    "default",
                                    True,
                                    1.0,
                                    4096,
                                    0.95,
                                    "http://localhost:8000/v1",
                                    "meta-llama/Llama-3.2-1B-Instruct",
                                    "",
                                ),
                            )

                # Check if summary column exists
                columns = conn.execute("PRAGMA table_info(conversations)").fetchall()
                if "summary" not in [col[1] for col in columns]:
                    conn.execute("ALTER TABLE conversations ADD COLUMN summary TEXT")

                # Check if updated_at columns exist for each table
                for table in ["conversations", "messages", "attachments", "settings", "system_prompts"]:
                    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
                    if "updated_at" not in [col[1] for col in columns]:
                        conn.execute(
                            f"ALTER TABLE {table} ADD COLUMN updated_at REAL DEFAULT (strftime('%s.%f', 'now'))"
                        )

    def create_conversation(self) -> str:
        """Create a new conversation.

        Returns:
            str: Unique identifier for the created conversation.
        """
        conversation_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as conn:
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

    def get_all_conversations(self) -> List[Dict]:
        """Retrieve all conversations with their message counts and last activity.

        Returns:
            List[Dict]: List of conversations with their metadata
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            conversations = conn.execute(
                """SELECT c.*,
                   COUNT(m.message_id) as message_count,
                   MAX(m.created_at) as last_message_at
                   FROM conversations c
                   LEFT JOIN messages m ON c.conversation_id = m.conversation_id
                   GROUP BY c.conversation_id
                   ORDER BY c.created_at ASC"""
            ).fetchall()

        return [dict(conv) for conv in conversations]

    def save_settings(self, settings: Dict) -> bool:
        """Save or update application settings."""
        with sqlite3.connect(self.db_path) as conn:
            current_time = time.time()

            # For existing settings, only check name uniqueness if name is changing
            if "id" in settings and settings["id"] is not None:
                current_name = conn.execute("SELECT name FROM settings WHERE id = ?", (settings["id"],)).fetchone()

                # Only check for duplicate names if name is being changed
                if current_name and current_name[0] != settings.get("name"):
                    existing = conn.execute(
                        "SELECT id FROM settings WHERE name = ? AND id != ?", (settings.get("name"), settings["id"])
                    ).fetchone()
                    if existing:
                        raise sqlite3.IntegrityError("Settings name must be unique")

                # Update existing setting - Fixed the parameter count here
                cursor = conn.execute(
                    """
                    UPDATE settings
                    SET name = ?,
                        temperature = ?,
                        max_tokens = ?,
                        top_p = ?,
                        host = ?,
                        model_name = ?,
                        api_key = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        settings.get("name", "Default Config"),
                        settings.get("temperature", 1.0),
                        settings.get("max_tokens", 4096),
                        settings.get("top_p", 0.95),
                        settings.get("host", "http://localhost:8000/v1"),
                        settings.get("model_name", "meta-llama/Llama-3.2-1B-Instruct"),
                        settings.get("api_key", ""),
                        current_time,
                        settings["id"],
                    ),
                )
                return cursor.rowcount > 0

            # For new settings, always check name uniqueness
            existing = conn.execute("SELECT id FROM settings WHERE name = ?", (settings.get("name"),)).fetchone()

            if existing:
                raise sqlite3.IntegrityError("Settings name must be unique")

            cursor = conn.execute(
                """
                INSERT INTO settings (
                    name, temperature, max_tokens, top_p,
                    host, model_name, api_key, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    settings.get("name", "New Config"),
                    settings.get("temperature", 1.0),
                    settings.get("max_tokens", 4096),
                    settings.get("top_p", 0.95),
                    settings.get("host", "http://localhost:8000/v1"),
                    settings.get("model_name", "meta-llama/Llama-3.2-1B-Instruct"),
                    settings.get("api_key", ""),
                    current_time,
                ),
            )
            return cursor.rowcount > 0

    def get_settings(self) -> Dict:
        """Retrieve current default application settings.

        Returns:
            Dict: Dictionary containing default settings
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            settings = conn.execute('SELECT * FROM settings WHERE "default" = true').fetchone()
            return dict(settings) if settings else {}

    def add_settings(self, settings: Dict) -> int:
        """Add a new settings configuration.

        Args:
            settings (Dict): Dictionary containing setting key-value pairs

        Returns:
            int: ID of the newly created settings

        Raises:
            sqlite3.IntegrityError: If settings name already exists
        """
        with sqlite3.connect(self.db_path) as conn:
            # Check for duplicate names
            existing = conn.execute("SELECT id FROM settings WHERE name = ?", (settings.get("name"),)).fetchone()

            if existing:
                raise sqlite3.IntegrityError("Settings name must be unique")

            cursor = conn.execute(
                """
                INSERT INTO settings (
                    name, temperature, max_tokens, top_p,
                    host, model_name, api_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    settings.get("name", "New Config"),
                    settings.get("temperature", 1.0),
                    settings.get("max_tokens", 4096),
                    settings.get("top_p", 0.95),
                    settings.get("host", "http://localhost:8000/v1"),
                    settings.get("model_name", "meta-llama/Llama-3.2-1B-Instruct"),
                    settings.get("api_key", ""),
                ),
            )
            return cursor.lastrowid

    def set_default_settings(self, settings_id: int) -> bool:
        """Mark a settings configuration as default.

        Args:
            settings_id (int): ID of the settings to mark as default

        Returns:
            bool: True if successful, False otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            # Remove current default
            conn.execute('UPDATE settings SET "default" = false WHERE "default" = true')

            # Set new default
            cursor = conn.execute('UPDATE settings SET "default" = true WHERE id = ?', (settings_id,))
            return cursor.rowcount > 0

    def get_all_settings(self) -> List[Dict]:
        """Retrieve all settings configurations.

        Returns:
            List[Dict]: List of all settings configurations
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            settings = conn.execute("SELECT * FROM settings ORDER BY name").fetchall()
            return [dict(setting) for setting in settings]

    def get_settings_by_id(self, settings_id: int) -> Optional[Dict]:
        """Retrieve settings configuration by ID.

        Args:
            settings_id (int): ID of the settings to retrieve

        Returns:
            Optional[Dict]: Dictionary containing settings if found, None otherwise
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            settings = conn.execute("SELECT * FROM settings WHERE id = ?", (settings_id,)).fetchone()
            return dict(settings) if settings else None

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
