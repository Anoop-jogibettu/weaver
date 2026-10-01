import http.server
import socketserver
import os
from pathlib import Path

# Dynamic paths — always co-located with github_miner.py
_HERE = Path(__file__).parent
LOG_PATH  = str(_HERE / "miner.log")
DATA_PATH = str(_HERE / "mined_concurrent_changes.jsonl")


HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Weaver Mining Progress</title>
    <style>
        body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; margin: 0; }
        .container { max-width: 800px; margin: 0 auto; }
        .card { background: #1e293b; padding: 30px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        h1 { color: #38bdf8; display: flex; align-items: center; gap: 10px; margin-top: 0; }
        .stat-box { display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 10px; }
        .stat { font-size: 36px; font-weight: 800; color: #10b981; }
        .stat-timer { font-size: 24px; font-weight: 800; color: #f59e0b; }
        .label { color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; }
        pre { background: #020617; padding: 20px; border-radius: 8px; overflow: auto; height: 350px; color: #a5b4fc; line-height: 1.5; font-size: 13px; border: 1px solid #1e293b;}
        .pulse { display: inline-block; width: 12px; height: 12px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
    </style>
    <meta http-equiv="refresh" content="3">
</head>
<body>
    <div class="container">
        <h1>⛏️ Weaver Mining Dashboard</h1>
        
        <div class="card">
            <div class="stat-box">
                <div>
                    <div class="label">Total Concurrent Edits Found</div>
                    <div class="stat">{samples}</div>
                </div>
                <div style="text-align: right;">
                    <div class="label" style="margin-bottom: 8px;">Status</div>
                    <div><span class="pulse"></span> <span style="color: #10b981; font-weight: bold; margin-left: 5px;">MINING IN PROGRESS</span></div>
                </div>
            </div>
            <div class="stat-box">
                <div>
                    <div class="label">Repos Completed</div>
                    <div class="stat" style="color: #38bdf8; font-size: 24px;">{repos_completed} / 50</div>
                </div>
                <div style="text-align: right;">
                    <div class="label">Estimated Time Remaining</div>
                    <div class="stat-timer">{eta}</div>
                </div>
            </div>
            <p style="color: #64748b; font-size: 13px; margin-top: 15px;">Auto-refreshing every 3 seconds to fetch the latest data from the background job.</p>
        </div>

        <div class="card">
            <h2 style="margin-top: 0; color: #cbd5e1; font-size: 18px;">Live Terminal Output</h2>
            <pre>{log}</pre>
        </div>
    </div>
</body>
</html>
"""

import time

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        
        samples = 0
        if os.path.exists(DATA_PATH):
            with open(DATA_PATH, 'r') as f:
                samples = sum(1 for line in f)
                
        log_content = "Log not found or starting up..."
        repos_completed = 0
        eta = "Calculating..."
        
        if os.path.exists(LOG_PATH):
            with open(LOG_PATH, 'r') as f:
                lines = f.readlines()
                log_content = "".join(lines[-40:]) # Show last 40 lines
                
                # Calculate ETA
                repos_completed = sum(1 for line in lines if "Mining complete!" in line)
                
                if repos_completed > 0:
                    start_time = os.path.getctime(LOG_PATH)
                    elapsed = time.time() - start_time
                    time_per_repo = elapsed / repos_completed
                    remaining_repos = max(0, 50 - repos_completed)
                    remaining_seconds = remaining_repos * time_per_repo
                    
                    from datetime import datetime, timedelta
                    completion_time = datetime.now() + timedelta(seconds=remaining_seconds)
                    eta = f"Today at {completion_time.strftime('%I:%M %p')}"
                elif len(lines) > 5:
                    eta = "Waiting for first repo..."

        response = HTML.replace("{samples}", str(samples)).replace("{log}", log_content).replace("{repos_completed}", str(repos_completed)).replace("{eta}", eta)
        self.wfile.write(response.encode())

if __name__ == "__main__":
    port = 8080
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"Progress dashboard running at http://localhost:{port}")
        httpd.serve_forever()
