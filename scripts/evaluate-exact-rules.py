#!/usr/bin/env python3
"""Evaluate curated exact rule IDs against selected ToS-100 test clauses."""

import argparse
import csv
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / "fixtures" / "exact-rules" / "tos100.tsv"
SOURCE_MD5 = "2c8f83c3c3ff3cf6a78f71e796c34942"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="Original ToS-100 test.csv")
    parser.add_argument("engine", type=Path, help="Built native evaluate binary")
    parser.add_argument("--with-provider", action="store_true",
                        help="Supply the published provider label as site context")
    args = parser.parse_args()

    if hashlib.md5(args.dataset.read_bytes()).hexdigest() != SOURCE_MD5:
        parser.error("test.csv does not match the pinned ToS-100 version")
    with args.dataset.open(encoding="utf-8-sig", newline="") as source:
        clauses = list(csv.DictReader(source))
    with LABELS.open(encoding="utf-8", newline="") as labels_file:
        labels = list(csv.DictReader(labels_file, delimiter="\t"))
    selected = [clauses[int(label["row"])] for label in labels]
    if any(row["document"] != label["provider"] for row, label in zip(selected, labels)):
        parser.error("provider name does not match the pinned row")
    inputs = (
        ({"text": row["text"], "provider": row["document"]} if args.with_provider else row["text"])
        for row in selected
    )
    payload = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in inputs)
    result = subprocess.run(
        [str(args.engine.resolve())], input=payload, encoding="utf-8", capture_output=True, check=True,
    )
    predictions = [json.loads(line)["rule_ids"] for line in result.stdout.splitlines()]
    if len(predictions) != len(labels):
        raise ValueError("engine returned the wrong number of rows")
    tp, fp, fn = Counter(), Counter(), Counter()
    agreements = 0
    for label, found in zip(labels, predictions):
        expected = set() if label["expected_rules"] == "-" else set(label["expected_rules"].split(","))
        actual = set(found)
        tp.update(expected & actual)
        fp.update(actual - expected)
        fn.update(expected - actual)
        if expected == actual:
            agreements += 1
        else:
            print(f'{label["provider"]} row {label["row"]}: '
                  f'missing {sorted(expected - actual)}, extra {sorted(actual - expected)}')
    print(f'Exact row agreement: {agreements}/{len(labels)} across '
          f'{len({label["provider"] for label in labels})} providers')
    for rule in sorted(tp.keys() | fp.keys() | fn.keys()):
        print(f"{rule}: TP {tp[rule]}, FP {fp[rule]}, FN {fn[rule]}")
    print(f"Total: TP {sum(tp.values())}, FP {sum(fp.values())}, FN {sum(fn.values())}")


if __name__ == "__main__":
    main()
