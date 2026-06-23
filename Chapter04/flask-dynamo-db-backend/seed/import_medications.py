import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))


def run():
    from modules import medications

    csv_path = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else medications.CSV_PATH
    )
    result = medications.import_csv_to_dynamo(csv_path)
    print(f"Inserted {result['imported']} records from {result['source']}")
    print("Seed complete")


if __name__ == "__main__":
    run()
