"""
launch_scaleforce.py — ScaleForce Capital Desktop Launcher
───────────────────────────────────────────────────────────
Double-click this file (or run: python launch_scaleforce.py)
to launch the Deal Intelligence Suite in your browser.

Requirements: pip install streamlit anthropic
"""

import subprocess
import sys
import os
import webbrowser
import time
import threading
import socket
from pathlib import Path


APP_NAME   = "ScaleForce Capital — Deal Intelligence Suite"
MAIN_FILE  = "Home.py"
PORT       = 8501
BROWSER_DELAY = 3  # seconds before opening browser


def find_free_port(start=8501):
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("localhost", port)) != 0:
                return port
    return start


def open_browser(port, delay):
    time.sleep(delay)
    webbrowser.open(f"http://localhost:{port}")


def check_dependencies():
    missing = []
    for pkg in ["streamlit", "anthropic"]:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"\n⚠️  Missing packages: {', '.join(missing)}")
        print("Installing now...")
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
        print("✅ Packages installed.\n")


def check_api_key():
    """Check for API key in .env file or environment."""
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
                os.environ["ANTHROPIC_API_KEY"] = key
                return True
    if os.environ.get("ANTHROPIC_API_KEY"):
        return True
    return False


def create_env_if_missing():
    env_file = Path(".env")
    if not env_file.exists():
        print("\n" + "="*60)
        print("  FIRST TIME SETUP — ScaleForce Capital Deal Suite")
        print("="*60)
        key = input("\n  Enter your Anthropic API key (sk-ant-...): ").strip()
        pwd = input("  Set a team password for this installation: ").strip()
        email = input("  Your notification email (where memos are sent): ").strip()

        env_file.write_text(f'''# ScaleForce Capital — Local Configuration
ANTHROPIC_API_KEY="{key}"
TEAM_PASSWORD="{pwd}"
NOTIFY_EMAIL="{email}"

# Optional: SMTP settings for email delivery
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your@gmail.com
# SMTP_PASSWORD=your-app-password
''')
        print("\n✅ Configuration saved to .env")
        print("   You can edit this file anytime to update settings.\n")


def load_env():
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip().strip('"')


def main():
    print("\n" + "="*60)
    print(f"  {APP_NAME}")
    print("="*60)

    # Change to the script's directory
    os.chdir(Path(__file__).parent)

    # First-time setup
    create_env_if_missing()

    # Load .env into environment
    load_env()

    # Check dependencies
    check_dependencies()

    # Find port
    port = find_free_port(PORT)

    # Open browser in background
    t = threading.Thread(target=open_browser, args=(port, BROWSER_DELAY), daemon=True)
    t.start()

    print(f"\n✅ Launching on http://localhost:{port}")
    print("   The app will open in your browser automatically.")
    print("   To stop: press Ctrl+C in this window.\n")

    # Build streamlit command
    cmd = [
        sys.executable, "-m", "streamlit", "run", MAIN_FILE,
        f"--server.port={port}",
        "--server.headless=true",
        "--browser.gatherUsageStats=false",
        f"--browser.serverAddress=localhost",
    ]

    # Pass secrets via environment (desktop mode — reads from .env)
    env = os.environ.copy()

    try:
        subprocess.run(cmd, env=env)
    except KeyboardInterrupt:
        print("\n\n  ScaleForce Deal Suite stopped. Goodbye.\n")


if __name__ == "__main__":
    main()
