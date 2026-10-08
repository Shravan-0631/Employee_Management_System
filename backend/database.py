"""
database.py
-----------
Handles SQLite connection, table creation, and one-time seed data.

Tables (normalised):
  departments (1) ----< employees (many)
"""

import os
import sqlite3

# employees.db lives next to this file, inside backend/
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "employees.db")


def get_connection():
    """Open a SQLite connection with foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # rows behave like dicts: row["name"]
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Create tables if they do not exist, then seed default rows."""
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS departments (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS employees (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id        TEXT NOT NULL UNIQUE,
                name          TEXT NOT NULL,
                department_id INTEGER NOT NULL,
                designation   TEXT NOT NULL,
                salary        REAL NOT NULL CHECK (salary > 0),
                contact       TEXT NOT NULL,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (department_id) REFERENCES departments(id)
            );

            CREATE TABLE IF NOT EXISTS career_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id        TEXT NOT NULL,
                event_date    TEXT NOT NULL,
                year          INTEGER NOT NULL,
                event_type    TEXT NOT NULL,
                title         TEXT NOT NULL,
                location      TEXT,
                message       TEXT NOT NULL,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (emp_id) REFERENCES employees(emp_id) ON DELETE CASCADE
            );
            """
        )
        _seed_departments(conn)
        _seed_employees(conn)
        _seed_career_history(conn)
        conn.commit()
    finally:
        conn.close()


def _seed_departments(conn):
    """Insert the six HR departments used by the app."""
    departments = (
        "Engineering",
        "HR",
        "Finance",
        "Marketing",
        "Operations",
        "Sales",
    )
    for name in departments:
        conn.execute(
            "INSERT OR IGNORE INTO departments (name) VALUES (?)",
            (name,),
        )


def _seed_employees(conn):
    """
    Seed eight Indian employees only when the table is empty.
    Salaries are annual CTC in INR.
    """
    count = conn.execute("SELECT COUNT(*) AS n FROM employees").fetchone()["n"]
    if count > 0:
        return

    # Lookup department ids by name so we never hard-code numeric FKs.
    rows = conn.execute("SELECT id, name FROM departments").fetchall()
    dept = {row["name"]: row["id"] for row in rows}

    employees = [
        ("EMP001", "Ananya Sharma", dept["Engineering"], "Software Engineer", 920000.00, "9876543210"),
        ("EMP002", "Rohan Mehta", dept["Finance"], "Financial Analyst", 780000.50, "9123456789"),
        ("EMP003", "Priya Nair", dept["HR"], "HR Business Partner", 850000.00, "8890123456"),
        ("EMP004", "Arjun Reddy", dept["Sales"], "Account Executive", 640000.00, "7012345678"),
        ("EMP005", "Meera Iyer", dept["Marketing"], "Brand Manager", 910000.00, "9988776655"),
        ("EMP006", "Vikram Singh", dept["Operations"], "Operations Lead", 1020000.00, "8123456789"),
        ("EMP007", "Sneha Patil", dept["Engineering"], "QA Engineer", 710000.00, "9765432109"),
        ("EMP008", "Karan Joshi", dept["Finance"], "Payroll Specialist", 560000.00, "6234567890"),
    ]

    conn.executemany(
        """
        INSERT INTO employees (emp_id, name, department_id, designation, salary, contact)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        employees,
    )


def _seed_career_history(conn):
    """
    Seed career and work history milestones for employees when table is empty.
    Matches the HR portal career history timeline view.
    """
    count = conn.execute("SELECT COUNT(*) AS n FROM career_history").fetchone()["n"]
    if count > 0:
        return

    history_items = [
        # Priya Nair (EMP003) — matching reference HR portal example
        ("EMP003", "19 December", 2024, "location", "Dubai Hub", "Dubai", "Your Location has been updated"),
        ("EMP003", "17 May", 2024, "designation", "HR Head", "Dubai", "Your Designation has been updated"),
        ("EMP003", "05 March", 2024, "department", "Human Resources", "California", "Your Department, Location have been updated"),
        ("EMP003", "12 June", 2021, "milestone", "HR Business Partner", "California", "Joined People Operations team"),

        # Ananya Sharma (EMP001)
        ("EMP001", "19 December", 2024, "location", "Bengaluru Tech Park", "Bengaluru", "Your Location has been updated to Bengaluru Campus"),
        ("EMP001", "17 May", 2024, "designation", "Lead Systems Architect", "Bengaluru", "Your Designation has been updated"),
        ("EMP001", "05 March", 2024, "department", "Core Engineering", "California", "Your Department, Location have been updated"),
        ("EMP001", "20 November", 2023, "project", "HR Internal Microservices", "Bengaluru", "Successfully led architecture overhaul for staff portal"),
        ("EMP001", "10 August", 2022, "milestone", "Software Engineer", "Pune", "Joined Engineering Division"),

        # Rohan Mehta (EMP002)
        ("EMP002", "15 October", 2024, "designation", "Senior Financial Analyst", "Mumbai", "Your Designation has been updated"),
        ("EMP002", "22 April", 2024, "location", "Nariman Point Hub", "Mumbai", "Your Location has been updated"),
        ("EMP002", "01 February", 2023, "project", "Fiscal Year Tax Audit", "Mumbai", "Completed Q4 statutory audit automation"),
        ("EMP002", "14 September", 2022, "milestone", "Financial Analyst", "Mumbai", "Joined Finance and Treasury team"),

        # Arjun Reddy (EMP004)
        ("EMP004", "18 November", 2024, "designation", "Senior Account Executive", "Hyderabad", "Your Designation has been updated"),
        ("EMP004", "09 June", 2024, "project", "Enterprise Client Expansion", "Hyderabad", "Achieved 140% annual quota target"),
        ("EMP004", "15 January", 2023, "milestone", "Account Executive", "Hyderabad", "Joined Corporate Sales"),

        # Meera Iyer (EMP005)
        ("EMP005", "04 December", 2024, "location", "Creative Studio Hub", "Bengaluru", "Your Location has been updated"),
        ("EMP005", "18 August", 2024, "designation", "Brand Strategy Lead", "Bengaluru", "Your Designation has been updated"),
        ("EMP005", "20 March", 2023, "project", "Global Rebranding Campaign", "Bengaluru", "Launched new corporate design identity"),

        # Vikram Singh (EMP006)
        ("EMP006", "11 November", 2024, "department", "Global Operations", "Delhi NCR", "Your Department has been updated"),
        ("EMP006", "25 May", 2024, "designation", "Operations Lead", "Delhi NCR", "Your Designation has been updated"),
        ("EMP006", "14 February", 2023, "milestone", "Operations Specialist", "Delhi NCR", "Joined Supply & Ops Division"),

        # Sneha Patil (EMP007)
        ("EMP007", "08 October", 2024, "project", "Automated QA Test Suite", "Bengaluru", "Deployed end-to-end regression pipelines"),
        ("EMP007", "12 March", 2024, "designation", "Senior QA Engineer", "Bengaluru", "Your Designation has been updated"),
        ("EMP007", "05 July", 2023, "milestone", "QA Engineer", "Pune", "Joined Quality Engineering"),

        # Karan Joshi (EMP008)
        ("EMP008", "28 September", 2024, "designation", "Payroll Specialist", "Mumbai", "Your Designation has been updated"),
        ("EMP008", "15 April", 2024, "project", "Payroll Portal Integration", "Mumbai", "Integrated direct statutory payouts"),
        ("EMP008", "10 November", 2023, "milestone", "Junior Payroll Associate", "Mumbai", "Joined Finance & HR Operations"),
    ]

    conn.executemany(
        """
        INSERT INTO career_history (emp_id, event_date, year, event_type, title, location, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        history_items,
    )
