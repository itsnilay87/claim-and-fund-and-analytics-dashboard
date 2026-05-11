import json
import urllib.request
import urllib.error

url = "http://localhost:8082/api/auth/login"
payload = {
    "email": "nmohod@5riverscap.com",
    "password": "TempPass2026!",
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
        print("STATUS=", resp.status)
        print(body[:500])
except urllib.error.HTTPError as e:
    print("STATUS=", e.code)
    print(e.read().decode("utf-8"))
except Exception as e:
    print("ERROR=", str(e))
