"""Exercise concurrent draw requests against an isolated local PostgreSQL cluster."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def verify(socket, env):
    psql = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket,
            "-U", "santa_test", "-d", "postgres"]

    def query(sql):
        return subprocess.run(psql, input=sql, text=True, capture_output=True,
                              check=True, env=env).stdout.strip()

    query((ROOT / "lib/demo-bootstrap.sql").read_text())
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        query(migration.read_text())

    users = [str(uuid4()) for _ in range(3)]
    for i, user in enumerate(users):
        query(f"insert into auth.users values ('{user}', 'test{i}@example.test', now(),false)")

    def rpc(user, operation, payload):
        return (f"set role authenticated; set request.jwt.claim.sub = '{user}'; "
                f"select public.circle_action('{operation}', '{json.dumps(payload)}'::jsonb);")

    circle = json.loads(query(rpc(users[0], "create", dict(name="Concurrency", person="Organizer",
                            budget=800, currency="INR", date="2026-12-24", message=""))))
    view = json.loads(query(rpc(users[0], "view", {"id": circle})))
    for user in users[1:]:
        query(rpc(user, "join", {"code": view["code"], "person": "Guest"}))
    draw = rpc(users[0], "draw", {"id": circle})

    with subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          text=True, env=env) as first:
        try:
            first.stdin.write("begin; " + draw + "\n\\echo draw_saved\n")
            first.stdin.flush()
            for line in first.stdout:
                if line.strip() == "draw_saved":
                    break
            else:
                raise RuntimeError("First draw failed before acquiring its lock.")
            with subprocess.Popen(psql + ["-c", draw], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True,
                                  env={**env, "PGAPPNAME": "santa_second_draw"}) as second:
                try:
                    deadline = time.monotonic() + 10
                    while query("select exists(select 1 from pg_stat_activity where "
                                "application_name='santa_second_draw' and wait_event_type='Lock')") != "t":
                        if second.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError("Second draw did not wait for the first transaction.")
                        time.sleep(0.05)
                    first.stdin.write("commit;\n\\q\n")
                    first.stdin.flush()
                    _, stderr = second.communicate(timeout=10)
                    assert second.returncode != 0 and "already been drawn" in stderr, stderr
                finally:
                    if second.poll() is None:
                        second.kill()
        finally:
            if first.poll() is None:
                first.terminate()
    assert query("select count(*)=3 and count(distinct recipient)=3 and "
                 "bool_and(giver<>recipient) from santa_private.assignments") == "t"
    print("Passed: concurrent PostgreSQL draws serialized and committed exactly one complete draw.")


if __name__ == "__main__":
    if not all(shutil.which(tool) for tool in ("initdb", "pg_ctl", "psql")):
        raise SystemExit("Add your local PostgreSQL bin directory to PATH before running this test.")
    with tempfile.TemporaryDirectory(prefix="santa-pg-") as tmp:
        env = {**os.environ, "LC_ALL": "C"}
        data = str(Path(tmp) / "data")
        subprocess.run(["initdb", "-D", data, "-U", "santa_test", "-E", "UTF8",
                        "--no-locale", "--auth=trust"], check=True, stdout=subprocess.DEVNULL, env=env)
        # No TCP listener. Only the process owner can enter the temporary socket directory.
        subprocess.run(["pg_ctl", "-D", data, "-l", str(Path(tmp) / "postgres.log"),
                        "-o", f"-k '{tmp}' -c listen_addresses=''", "-w", "start"], check=True, env=env)
        try:
            verify(tmp, env)
        finally:
            subprocess.run(["pg_ctl", "-D", data, "-m", "fast", "-w", "stop"], check=True, env=env)
