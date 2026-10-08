"""
app.py
------
Flask REST API for the Employee Management System.

Run:
  python app.py
  -> http://127.0.0.1:5000

CORS is limited to the frontend origin (port 3000).
All SQL uses bound parameters — never string concatenation.
"""

import os
import re
import sqlite3

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from database import get_connection, init_db

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

app = Flask(__name__)

# Frontend is served on port 3000 or port 5000.
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*"
        }
    },
)

# ---- Validation patterns (same rules as the frontend) ----
EMP_ID_RE = re.compile(r"^EMP\d{3,}$")
NAME_RE = re.compile(r"^[A-Za-z\s]{2,}$")
CONTACT_RE = re.compile(r"^[6-9]\d{9}$")
SALARY_RE = re.compile(r"^\d+(\.\d{1,2})?$")


def json_error(message, status):
    """Standard JSON error body used by every failing route."""
    return jsonify({"success": False, "error": message}), status


def row_to_employee(row):
    """Turn a JOIN row into the JSON shape the UI expects."""
    return {
        "id": row["id"],
        "emp_id": row["emp_id"],
        "name": row["name"],
        "department_id": row["department_id"],
        "department": row["department"],
        "designation": row["designation"],
        "salary": row["salary"],
        "contact": row["contact"],
        "created_at": row["created_at"],
    }


def validate_employee(payload, *, require_all=True):
    """
    Validate request JSON both for POST and PUT.
    Returns (cleaned_dict, None) or (None, (response, status)).
    """
    if not isinstance(payload, dict):
        return None, json_error("Request body must be a JSON object.", 400)

    fields = ("emp_id", "name", "designation", "salary", "contact")
    data = {}
    errors = {}

    for field in fields:
        if field in payload:
            value = payload[field]
            data[field] = value if not isinstance(value, str) else value.strip()
        elif require_all:
            errors[field] = f"{field} is required."

    # Department can be supplied as 'department' (name) or 'department_id' (id)
    if "department" in payload:
        data["department"] = payload["department"] if not isinstance(payload["department"], str) else payload["department"].strip()
    elif "department_id" in payload:
        data["department"] = payload["department_id"]
    elif require_all:
        errors["department"] = "department is required."

    if "emp_id" in data:
        emp_id = str(data["emp_id"]).strip().upper()
        data["emp_id"] = emp_id
        if not EMP_ID_RE.match(emp_id):
            errors["emp_id"] = "Employee ID must follow the format EMP001 (EMP + 3 or more digits)."

    if "name" in data:
        name = str(data["name"]).strip()
        data["name"] = name
        if not NAME_RE.match(name) or len(name) < 2 or not any(c.isalpha() for c in name):
            errors["name"] = "Name must be at least 2 letters (letters and spaces only)."

    if "designation" in data:
        designation = str(data["designation"]).strip()
        data["designation"] = designation
        if len(designation) < 2:
            errors["designation"] = "Designation must be at least 2 characters."

    if "department" in data:
        dept = str(data["department"]).strip()
        if not dept:
            errors["department"] = "Department is required."

    if "salary" in data:
        raw_salary = data["salary"]
        salary_text = str(raw_salary).strip()
        try:
            salary = float(salary_text)
        except (TypeError, ValueError):
            errors["salary"] = "Salary must be a positive number with up to 2 decimals."
            salary = None

        if salary is not None:
            if salary <= 0:
                errors["salary"] = "Salary must be greater than 0."
            elif not SALARY_RE.match(salary_text):
                errors["salary"] = "Salary can have at most 2 decimal places."
            else:
                data["salary"] = round(salary, 2)

    if "contact" in data:
        contact = str(data["contact"]).strip()
        data["contact"] = contact
        if not CONTACT_RE.match(contact):
            errors["contact"] = "Contact must be exactly 10 digits and start with 6, 7, 8, or 9."

    if errors:
        return None, (jsonify({"success": False, "error": "Validation failed.", "fields": errors}), 400)

    return data, None


def get_department_id(conn, dept_value):
    """
    Resolve department to its primary key id.
    Accepts either department name (e.g. 'Engineering') or numeric ID (e.g. 1).
    Used to support both form submissions and external REST API clients.
    """
    if dept_value is None:
        return None
    # If already a number or numeric string
    if isinstance(dept_value, int) or (isinstance(dept_value, str) and dept_value.strip().isdigit()):
        row = conn.execute("SELECT id FROM departments WHERE id = ?", (int(dept_value),)).fetchone()
        if row:
            return row["id"]
    # Look up by department name
    row = conn.execute(
        "SELECT id FROM departments WHERE LOWER(name) = LOWER(?)",
        (str(dept_value).strip(),),
    ).fetchone()
    return row["id"] if row else None


EMPLOYEE_SELECT = """
    SELECT e.id, e.emp_id, e.name, e.department_id, d.name AS department,
           e.designation, e.salary, e.contact, e.created_at
    FROM employees e
    JOIN departments d ON d.id = e.department_id
"""


@app.get("/api/employees")
def list_employees():
    """
    GET /api/employees
    Returns all employees joined with their department name.
    Ordered by employee ID.
    Status: 200 OK
    """
    try:
        conn = get_connection()
        try:
            rows = conn.execute(EMPLOYEE_SELECT + " ORDER BY e.emp_id").fetchall()
            return jsonify({"success": True, "data": [row_to_employee(r) for r in rows]}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.get("/api/employees/search")
def search_employees():
    """
    GET /api/employees/search?q=&department=
    Searches employees across emp_id, name, department, or designation.
    Optional 'department' param filters specifically by department name.
    Status: 200 OK
    """
    try:
        q = (request.args.get("q") or "").strip()
        department = (request.args.get("department") or "").strip()

        clauses = []
        params = []

        if q:
            # Matches emp_id, name, department name, or designation (case-insensitive in SQLite)
            clauses.append("(e.emp_id LIKE ? OR e.name LIKE ? OR d.name LIKE ? OR e.designation LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like, like])

        if department:
            clauses.append("LOWER(d.name) = LOWER(?)")
            params.append(department)

        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

        conn = get_connection()
        try:
            rows = conn.execute(
                EMPLOYEE_SELECT + where + " ORDER BY e.emp_id",
                params,
            ).fetchall()
            return jsonify({"success": True, "data": [row_to_employee(r) for r in rows]}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.post("/api/employees")
def add_employee():
    """POST /api/employees — create one employee. 201 on success, 409 on duplicate emp_id."""
    try:
        data, err = validate_employee(request.get_json(silent=True), require_all=True)
        if err:
            return err

        conn = get_connection()
        try:
            department_id = get_department_id(conn, data["department"])
            if department_id is None:
                return json_error("Unknown department.", 400)

            existing = conn.execute(
                "SELECT 1 FROM employees WHERE emp_id = ?",
                (data["emp_id"],),
            ).fetchone()
            if existing:
                return json_error(f"Employee ID {data['emp_id']} already exists.", 409)

            conn.execute(
                """
                INSERT INTO employees (emp_id, name, department_id, designation, salary, contact)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    data["emp_id"],
                    data["name"],
                    department_id,
                    data["designation"],
                    data["salary"],
                    data["contact"],
                ),
            )
            conn.commit()

            row = conn.execute(
                EMPLOYEE_SELECT + " WHERE e.emp_id = ?",
                (data["emp_id"],),
            ).fetchone()
            return jsonify({"success": True, "data": row_to_employee(row)}), 201
        finally:
            conn.close()
    except sqlite3.IntegrityError as exc:
        # Unique constraint or CHECK(salary > 0)
        message = str(exc)
        if "emp_id" in message.lower() or "UNIQUE" in message:
            return json_error("Employee ID already exists.", 409)
        return json_error(message, 400)
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.put("/api/employees/<emp_id>")
def update_employee(emp_id):
    """
    PUT /api/employees/<emp_id>
    Updates an existing employee. Returns 200 on success, 404 if missing.
    """
    try:
        emp_id = emp_id.upper().strip()
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return json_error("Request body must be a JSON object.", 400)

        # Default emp_id from the URL path if omitted from the body
        if "emp_id" not in payload:
            payload["emp_id"] = emp_id

        data, err = validate_employee(payload, require_all=True)
        if err:
            return err

        if data["emp_id"] != emp_id:
            return json_error("emp_id in the URL and body must match.", 400)

        conn = get_connection()
        try:
            current = conn.execute(
                "SELECT id FROM employees WHERE emp_id = ?",
                (emp_id,),
            ).fetchone()
            if current is None:
                return json_error(f"No employee found with ID {emp_id}.", 404)

            department_id = get_department_id(conn, data["department"])
            if department_id is None:
                return json_error("Unknown department.", 400)

            conn.execute(
                """
                UPDATE employees
                SET name = ?, department_id = ?, designation = ?, salary = ?, contact = ?
                WHERE emp_id = ?
                """,
                (
                    data["name"],
                    department_id,
                    data["designation"],
                    data["salary"],
                    data["contact"],
                    emp_id,
                ),
            )
            conn.commit()

            row = conn.execute(
                EMPLOYEE_SELECT + " WHERE e.emp_id = ?",
                (emp_id,),
            ).fetchone()
            return jsonify({"success": True, "data": row_to_employee(row)}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.delete("/api/employees/<emp_id>")
def delete_employee(emp_id):
    """DELETE /api/employees/<emp_id> — 404 if the employee does not exist."""
    try:
        emp_id = emp_id.upper().strip()
        conn = get_connection()
        try:
            current = conn.execute(
                "SELECT id FROM employees WHERE emp_id = ?",
                (emp_id,),
            ).fetchone()
            if current is None:
                return json_error(f"No employee found with ID {emp_id}.", 404)

            conn.execute("DELETE FROM employees WHERE emp_id = ?", (emp_id,))
            conn.commit()
            return jsonify({"success": True, "message": f"{emp_id} removed."}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.get("/api/employees/<emp_id>")
def get_employee(emp_id):
    """
    GET /api/employees/<emp_id>
    Returns single employee profile with manager info, teammates, and career history.
    Status: 200 OK or 404 Not Found.
    """
    try:
        emp_id = emp_id.upper().strip()
        conn = get_connection()
        try:
            row = conn.execute(EMPLOYEE_SELECT + " WHERE e.emp_id = ?", (emp_id,)).fetchone()
            if row is None:
                return json_error(f"No employee found with ID {emp_id}.", 404)

            emp_data = row_to_employee(row)

            # Find teammates/colleagues in the same department
            colleagues = conn.execute(
                EMPLOYEE_SELECT + " WHERE e.department_id = ? AND e.emp_id != ? LIMIT 3",
                (emp_data["department_id"], emp_id),
            ).fetchall()

            # Find reporting manager (lead / head / manager from another role or same dept)
            manager_row = conn.execute(
                EMPLOYEE_SELECT + " WHERE (e.designation LIKE '%Lead%' OR e.designation LIKE '%Head%' OR e.designation LIKE '%Manager%') AND e.emp_id != ? LIMIT 1",
                (emp_id,),
            ).fetchone()
            if manager_row is None and colleagues:
                manager_row = colleagues[0]

            # Fetch career / work history
            history_rows = conn.execute(
                """
                SELECT id, emp_id, event_date, year, event_type, title, location, message, created_at
                FROM career_history
                WHERE emp_id = ?
                ORDER BY year DESC, id DESC
                """,
                (emp_id,),
            ).fetchall()

            history = [
                {
                    "id": h["id"],
                    "emp_id": h["emp_id"],
                    "event_date": h["event_date"],
                    "year": h["year"],
                    "event_type": h["event_type"],
                    "title": h["title"],
                    "location": h["location"] or "Headquarters",
                    "message": h["message"],
                    "created_at": h["created_at"],
                }
                for h in history_rows
            ]

            return jsonify({
                "success": True,
                "data": emp_data,
                "reporting_to": row_to_employee(manager_row) if manager_row else None,
                "colleagues": [row_to_employee(c) for c in colleagues],
                "career_history": history,
            }), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.get("/api/employees/<emp_id>/history")
def get_employee_history(emp_id):
    """GET /api/employees/<emp_id>/history — career & work history for this employee."""
    try:
        emp_id = emp_id.upper().strip()
        conn = get_connection()
        try:
            exists = conn.execute("SELECT 1 FROM employees WHERE emp_id = ?", (emp_id,)).fetchone()
            if not exists:
                return json_error(f"No employee found with ID {emp_id}.", 404)

            rows = conn.execute(
                """
                SELECT id, emp_id, event_date, year, event_type, title, location, message, created_at
                FROM career_history
                WHERE emp_id = ?
                ORDER BY year DESC, id DESC
                """,
                (emp_id,),
            ).fetchall()

            return jsonify({
                "success": True,
                "data": [
                    {
                        "id": r["id"],
                        "emp_id": r["emp_id"],
                        "event_date": r["event_date"],
                        "year": r["year"],
                        "event_type": r["event_type"],
                        "title": r["title"],
                        "location": r["location"] or "Headquarters",
                        "message": r["message"],
                        "created_at": r["created_at"],
                    }
                    for r in rows
                ],
            }), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.post("/api/employees/<emp_id>/history")
def add_employee_history(emp_id):
    """
    POST /api/employees/<emp_id>/history
    Add new career milestone, work update, or location change.
    """
    try:
        emp_id = emp_id.upper().strip()
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return json_error("Request body must be a JSON object.", 400)

        conn = get_connection()
        try:
            exists = conn.execute("SELECT 1 FROM employees WHERE emp_id = ?", (emp_id,)).fetchone()
            if not exists:
                return json_error(f"No employee found with ID {emp_id}.", 404)

            event_date = str(payload.get("event_date") or "").strip()
            year = payload.get("year")
            event_type = str(payload.get("event_type") or "project").strip().lower()
            title = str(payload.get("title") or "").strip()
            location = str(payload.get("location") or "Headquarters").strip()
            message = str(payload.get("message") or "").strip()

            if not event_date:
                return json_error("event_date is required (e.g. '19 December').", 400)
            if not year or not str(year).isdigit():
                return json_error("year is required as an integer (e.g. 2024).", 400)
            if not title:
                return json_error("title or designation is required.", 400)
            if not message:
                return json_error("message or work description is required.", 400)

            valid_types = ("location", "designation", "department", "project", "milestone")
            if event_type not in valid_types:
                event_type = "project"

            cursor = conn.execute(
                """
                INSERT INTO career_history (emp_id, event_date, year, event_type, title, location, message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (emp_id, event_date, int(year), event_type, title, location, message),
            )
            conn.commit()
            new_id = cursor.lastrowid

            row = conn.execute("SELECT * FROM career_history WHERE id = ?", (new_id,)).fetchone()
            return jsonify({
                "success": True,
                "data": {
                    "id": row["id"],
                    "emp_id": row["emp_id"],
                    "event_date": row["event_date"],
                    "year": row["year"],
                    "event_type": row["event_type"],
                    "title": row["title"],
                    "location": row["location"],
                    "message": row["message"],
                    "created_at": row["created_at"],
                },
            }), 201
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.delete("/api/history/<int:history_id>")
def delete_history_item(history_id):
    """DELETE /api/history/<history_id> — delete a history event."""
    try:
        conn = get_connection()
        try:
            current = conn.execute("SELECT id FROM career_history WHERE id = ?", (history_id,)).fetchone()
            if not current:
                return json_error(f"History entry #{history_id} not found.", 404)

            conn.execute("DELETE FROM career_history WHERE id = ?", (history_id,))
            conn.commit()
            return jsonify({"success": True, "message": f"History entry #{history_id} removed."}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.get("/api/departments")
def list_departments():
    """GET /api/departments — names used by the filter and the form."""
    try:
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT id, name FROM departments ORDER BY name"
            ).fetchall()
            data = [{"id": r["id"], "name": r["name"]} for r in rows]
            return jsonify({"success": True, "data": data}), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


@app.get("/api/stats")
def stats():
    """
    GET /api/stats
    Returns total employees, department count, average salary,
    and headcount per department.
    """
    try:
        conn = get_connection()
        try:
            total = conn.execute("SELECT COUNT(*) AS n FROM employees").fetchone()["n"]
            dept_count = conn.execute("SELECT COUNT(*) AS n FROM departments").fetchone()["n"]
            avg_row = conn.execute("SELECT AVG(salary) AS avg_salary FROM employees").fetchone()
            avg_salary = round(avg_row["avg_salary"] or 0, 2)

            by_dept = conn.execute(
                """
                SELECT d.name AS department, COUNT(e.id) AS headcount
                FROM departments d
                LEFT JOIN employees e ON e.department_id = d.id
                GROUP BY d.id
                ORDER BY d.name
                """
            ).fetchall()

            return jsonify(
                {
                    "success": True,
                    "data": {
                        "total_employees": total,
                        "department_count": dept_count,
                        "average_salary": avg_salary,
                        "by_department": [
                            {"department": r["department"], "headcount": r["headcount"]}
                            for r in by_dept
                        ],
                    },
                }
            ), 200
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return json_error(f"Database error: {exc}", 500)
    except Exception as exc:
        return json_error(str(exc), 500)


# -------------------------------------------------------------
# Static Frontend Serving
# Allows accessing the web portal directly at http://127.0.0.1:5000
# -------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    target = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(target):
        return send_from_directory(FRONTEND_DIR, path)
    return json_error("Route not found.", 404)


@app.errorhandler(404)
def not_found(_err):
    return json_error("Route not found.", 404)


@app.errorhandler(405)
def method_not_allowed(_err):
    return json_error("Method not allowed.", 405)


if __name__ == "__main__":
    init_db()
    # debug=True reloads on save — useful while developing the mini project.
    app.run(host="127.0.0.1", port=5000, debug=True)
