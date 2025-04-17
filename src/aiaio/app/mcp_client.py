import re
from contextlib import AsyncExitStack
from typing import Any, Dict, List, Optional, Tuple

from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client

from aiaio import logger


class MCPClient:
    """Client for interacting with Model Control Protocol (MCP) servers.

    This client can connect to either SSE or stdio MCP servers and provides
    methods to call tools exposed by these servers.
    """

    def __init__(self):
        """Initialize a new MCP client."""
        self.session: Optional[ClientSession] = None
        self.exit_stack = AsyncExitStack()
        self._streams_context = None
        self._session_context = None
        self.stdio = None
        self.writer = None
        self.tools = []

    async def connect_to_sse_server(self, server_url: str) -> None:
        """Connect to an SSE MCP server.

        Args:
            server_url: URL of the SSE MCP server to connect to

        Raises:
            Exception: If connection or initialization fails
        """
        logger.debug(f"Connecting to SSE MCP server at {server_url}")

        try:
            self._streams_context = sse_client(url=server_url)
            streams = await self.exit_stack.enter_async_context(self._streams_context)

            self._session_context = ClientSession(*streams)
            self.session = await self.exit_stack.enter_async_context(self._session_context)

            # Initialize
            await self.session.initialize()

            # List available tools
            response = await self.session.list_tools()
            self.tools = response.tools
            logger.info(
                f"Connected to SSE MCP Server at {server_url}. Available tools: {[tool.name for tool in self.tools]}"
            )
        except Exception as e:
            logger.error(f"Failed to connect to SSE MCP server: {e}")
            await self.close()
            raise

    async def connect_to_stdio_server(self, server_script_path: str) -> None:
        """Connect to a stdio MCP server.

        Args:
            server_script_path: Path to the script or npm package for the stdio server

        Raises:
            ValueError: If the server script has an unsupported file extension
            Exception: If connection or initialization fails
        """
        try:
            command, args = self._get_stdio_command_args(server_script_path)

            server_params = StdioServerParameters(command=command, args=args, env=None)

            logger.debug(f"Connecting to stdio MCP server with command: {command} and args: {args}")

            # Start the server
            stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
            self.stdio, self.writer = stdio_transport
            self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.writer))

            await self.session.initialize()

            # List available tools
            response = await self.session.list_tools()
            self.tools = response.tools
            logger.info(f"Connected to stdio MCP Server. Available tools: {[tool.name for tool in self.tools]}")
        except Exception as e:
            logger.error(f"Failed to connect to stdio MCP server: {e}")
            await self.close()
            raise

    def _get_stdio_command_args(self, server_script_path: str) -> Tuple[str, List[str]]:
        """Determine the command and arguments for launching the stdio server.

        Args:
            server_script_path: Path to the script or npm package

        Returns:
            Tuple of (command, arguments list)

        Raises:
            ValueError: If the server script has an unsupported file extension
        """
        args = [server_script_path, "--ignore-robots-txt"]

        # Determine if the server is a file path or npm package
        if server_script_path.startswith("@") or "/" not in server_script_path:
            # Assume it's an npm package
            return "npx", args

        # It's a file path
        if server_script_path.endswith(".py"):
            return "python", args
        elif server_script_path.endswith(".js"):
            return "node", args
        else:
            raise ValueError("Server script must be a .py, .js file or npm package.")

    async def connect_to_server(self, server_path_or_url: str) -> None:
        """Connect to an MCP server (either stdio or SSE).

        Args:
            server_path_or_url: URL or script path of the MCP server

        Raises:
            Exception: If connection fails
        """
        # Check if the input is a URL (for SSE server)
        url_pattern = re.compile(r"^https?://")

        if url_pattern.match(server_path_or_url):
            # It's a URL, connect to SSE server
            await self.connect_to_sse_server(server_path_or_url)
        else:
            # It's a script path, connect to stdio server
            await self.connect_to_stdio_server(server_path_or_url)

    async def call_tool(self, tool_name: str, tool_args: Dict[str, Any]) -> Any:
        """Call a tool on the connected MCP server.

        Args:
            tool_name: Name of the tool to call
            tool_args: Arguments to pass to the tool

        Returns:
            Result from the tool call

        Raises:
            RuntimeError: If not connected to a server
            Exception: If the tool call fails
        """
        if not self.session:
            raise RuntimeError("Not connected to an MCP server. Call connect_to_server first.")

        logger.debug(f"Calling tool {tool_name} with args {tool_args}...")
        try:
            result = await self.session.call_tool(tool_name, tool_args)
            return result
        except Exception as e:
            logger.error(f"Tool call failed: {e}")
            raise

    async def close(self) -> None:
        """Close the connection and clean up resources."""
        if self.session:
            logger.debug("Closing MCP client connection")
            await self.exit_stack.aclose()
            self.session = None
            self.stdio = None
            self.writer = None
