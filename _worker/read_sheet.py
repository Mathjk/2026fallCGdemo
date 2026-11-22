"""Read a teacher's spreadsheet into UTF-8 JSON on stdout."""
import csv
import io
import json
import pathlib
import sys


def table(path):
    if path.suffix.lower() == ".csv":
        raw = path.read_bytes()
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("gb18030")
        yield from csv.reader(io.StringIO(content, newline=""))
    elif path.suffix.lower() == ".xlsx":
        from openpyxl import load_workbook

        book = load_workbook(path, read_only=True, data_only=True)
        try:
            # Excel remembers the last tab the teacher viewed before saving.
            sheet = book["学生名单与分配"] if {"学生名单与分配", "主题目录"}.issubset(book.sheetnames) else book.active
            for row in sheet.iter_rows():
                values = []
                for cell in row:
                    value = cell.value
                    fmt = getattr(cell, "number_format", "") or ""
                    if isinstance(value, int) and fmt and set(fmt) == {"0"}:
                        value = str(value).zfill(len(fmt))
                    values.append("" if value is None else str(value))
                yield values
        finally:
            book.close()
    else:
        raise ValueError("请选择 .csv 或 .xlsx 文件。")


def read(path):
    rows = iter(table(path))
    header = [c.strip() for c in next(rows, [])]
    keys = ["学号", "姓名", "学院", "主题编号"]
    if any(header.count(k) != 1 for k in keys):
        raise ValueError("表头应包含学号、姓名、学院、主题编号各一列。")
    indices = [header.index(k) for k in keys]
    students = {}
    for number, row in enumerate(rows, 2):
        if not any(c.strip() for c in row):
            continue
        sid, name, college, topic = [(row[i] if i < len(row) else "").strip() for i in indices]
        s = students.setdefault(sid, {"id": sid, "name": name, "college": college, "topics": []})
        if (s["name"], s["college"]) != (name, college):
            raise ValueError(f"第 {number} 行的个人信息与同一学号的其他行不一致。")
        if topic:
            if not topic.isascii() or not topic.isdigit() or int(topic) in s["topics"]:
                raise ValueError(f"第 {number} 行主题编号无效或重复。")
            s["topics"].append(int(topic))
    return list(students.values())


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(json.dumps(read(pathlib.Path(sys.argv[1])), ensure_ascii=False).encode("utf-8"))
    except ImportError:
        sys.exit("Reading .xlsx needs openpyxl: python -m pip install openpyxl")
    except (ValueError, OSError) as error:
        sys.exit(str(error))
