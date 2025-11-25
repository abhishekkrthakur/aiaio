#!/bin/bash

# Exit on error
set -e

echo "Building Mac Application..."

# Generate desktop.py
cat <<EOF > desktop.py
import logging
import os
import sys
import threading
import time
import traceback

# Setup logging immediately
try:
    app_dir = os.path.expanduser("~/.aiaio")
    os.makedirs(app_dir, exist_ok=True)
    os.chdir(app_dir)

    log_file = os.path.join(app_dir, "aiaio_debug.log")
    # Clear previous log
    with open(log_file, "w") as f:
        f.write("")
        
    logging.basicConfig(
        filename=log_file,
        level=logging.DEBUG,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    logger = logging.getLogger(__name__)
    logger.info("Starting desktop.py (Simplified)...")
except Exception as e:
    with open(os.path.expanduser("~/aiaio_critical_fail.txt"), "w") as f:
        f.write(f"Failed to setup logging: {e}\n")
    sys.exit(1)

# Imports
try:
    logger.info("Importing webview...")
    import webview
    logger.info("Importing uvicorn...")
    import uvicorn
    logger.info("Importing app...")
    from aiaio.app.app import app
except Exception as e:
    logger.critical(f"Import failed: {e}")
    logger.critical(traceback.format_exc())
    sys.exit(1)

# Configuration
HOST = "127.0.0.1"
PORT = 8000
TITLE = "aiaio"

def start_server():
    """Start the FastAPI server."""
    try:
        logger.info(f"Starting server on {HOST}:{PORT}")
        config = uvicorn.Config(app, host=HOST, port=PORT, log_level="debug", loop="asyncio")
        server = uvicorn.Server(config)
        # Disable signal handlers
        server.install_signal_handlers = lambda: None
        server.run()
    except Exception as e:
        logger.error(f"Server failed: {e}")
        logger.error(traceback.format_exc())

def main():
    """Main entry point."""
    try:
        logger.info("Main started.")
        
        # Start server
        server_thread = threading.Thread(target=start_server, daemon=True)
        server_thread.start()
        
        time.sleep(1)

        # Create window
        logger.info("Creating window...")
        window = webview.create_window(TITLE, f"http://{HOST}:{PORT}", width=1200, height=800)
        
        def on_loaded():
            logger.info("Window loaded, disabling context menu...")
            window.evaluate_js("window.addEventListener('contextmenu', function(e) { e.preventDefault(); }, false);")

        window.events.loaded += on_loaded
        
        logger.info("Starting webview...")
        webview.start(debug=False)
        logger.info("Webview exited.")
    except Exception as e:
        logger.critical(f"Crash in main: {e}")
        logger.critical(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.critical(f"Global crash: {e}")
        logger.critical(traceback.format_exc())
        sys.exit(1)
EOF

# Install dependencies if needed
# pip install pywebview pyinstaller

# Clean previous builds
rm -rf build dist

# Build with PyInstaller
# --windowed: No console window
# --name: App name
# --add-data: Include templates and static files
# --hidden-import: Ensure uvicorn and other dynamic imports are caught
pyinstaller desktop.py \
    --name "aiaio" \
    --windowed \
    --icon "ui.png" \
    --add-data "src/aiaio/app/templates:aiaio/app/templates" \
    --add-data "src/aiaio/app/static:aiaio/app/static" \
    --hidden-import "uvicorn.logging" \
    --hidden-import "uvicorn.loops" \
    --hidden-import "uvicorn.loops.auto" \
    --hidden-import "uvicorn.protocols" \
    --hidden-import "uvicorn.protocols.http" \
    --hidden-import "uvicorn.protocols.http.auto" \
    --hidden-import "uvicorn.protocols.websockets" \
    --hidden-import "uvicorn.protocols.websockets.auto" \
    --hidden-import "uvicorn.lifespan" \
    --hidden-import "uvicorn.lifespan.on" \
    --hidden-import "webview" \
    --collect-all "aiaio"

echo "Build complete! The app is in dist/aiaio.app"

# Ad-hoc sign the application bundle to ensure validity
echo "Signing application bundle..."
codesign --force --deep --sign - dist/aiaio.app

# Create DMG using dmgbuild
echo "Creating DMG..."

# Install dmgbuild if not present
uv pip install dmgbuild

# Generate dmg settings
cat <<EOF > dist/dmg_settings.py
import os.path

application = 'dist/aiaio.app'
appname = 'aiaio'

format = 'UDBZ'
size = None
files = [ application ]
symlinks = { 'Applications': '/Applications' }
icon_locations = {
    'aiaio.app': (100, 100),
    'Applications': (500, 100)
}
window_rect = ((100, 100), (600, 400))
EOF

# Run dmgbuild
dmgbuild -s dist/dmg_settings.py "aiaio" dist/aiaio.dmg

# Cleanup
rm dist/dmg_settings.py
rm desktop.py

echo "Build complete! The DMG is in dist/aiaio.dmg"
