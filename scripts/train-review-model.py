#!/usr/bin/env python3
"""Fit and evaluate PoisonPill's optional review model on ToS-100 CSV splits."""

import argparse
import csv
import json
import re
import struct
import subprocess
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_curve

ROOT = Path(__file__).resolve().parents[1]
DIMENSIONS = 4096
CLASSES = {
    "A": "forced_arbitration",
    "CH": "unilateral_modification",
    "LTD": "liability_caps",
    "TER": "termination_asymmetry",
}
# Conservative provider families spanning the published splits.
FAMILIES = [
    "amazon goodreads twitch",
    "nintendo pokemon",
    "facebook instagram whatsapp crowd tangle crowdtangle masquerade moves oculus onavo",
    "microsoft linkedin skype worldofwarcraft",
    "google youtube fitbit",
    "musically tiktok",
    "wechat supercell",
    "slack_customer slack_user",
    "expedia skyscanner",
    "match tinder",
]
PROVIDER = {name: group.split()[0] for group in FAMILIES for name in group.split()}


def normalized(text):
    return " ".join(re.findall(r"[a-z0-9]+", text.encode("ascii", "replace").decode().lower()))[:1024]


def feature_hash(value):
    result = 2166136261
    for byte in value:
        result = ((result ^ byte) * 16777619) & 0xFFFFFFFF
    return result % DIMENSIONS


def indices(text):
    data = normalized(text).encode()
    words = data.split()
    features = {feature_hash(data[i:i+4]) for i in range(max(0, len(data)-3))}
    features.update(feature_hash(b"@" + word) for word in words)
    features.update(feature_hash(b"@" + left + b" " + right) for left, right in zip(words, words[1:]))
    return sorted(features)


def read_splits(directory):
    splits = {}
    groups_seen, clauses_seen = set(), set()
    # Keep held-out providers intact. Earlier splits lose overlapping groups
    # and exact normalized clauses before any fit or threshold selection.
    for part in ("test", "validation", "train"):
        with (directory / f"{part}.csv").open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source))
        kept = []
        for row in rows:
            provider = row["document"].casefold().strip()
            group = PROVIDER.get(provider, provider)
            clause = normalized(row["text"])
            if clause and group not in groups_seen and clause not in clauses_seen:
                kept.append((group, clause, row))
        groups = {group for group, _, _ in kept}
        clauses = {clause for _, clause, _ in kept}
        groups_seen.update(groups)
        clauses_seen.update(clauses)
        splits[part] = [row for _, _, row in kept]
        print(f"{part}: {len(kept)} clauses, {len(groups)} provider groups, {len(rows)-len(kept)} excluded")
    return splits


def matrix(rows):
    features = [indices(row["text"]) for row in rows]
    flat = [index for clause in features for index in clause]
    offsets = np.cumsum([0, *(len(clause) for clause in features)])
    return csr_matrix((np.ones(len(flat)), flat, offsets), shape=(len(rows), DIMENSIONS))


def calibrate(truth, scores):
    precision, recall, thresholds = precision_recall_curve(truth, scores)
    # F0.5 puts extra weight on precision for optional review suggestions.
    f = 1.25 * precision[:-1] * recall[:-1] / np.maximum(0.25 * precision[:-1] + recall[:-1], 1e-9)
    return int(thresholds[np.argmax(f)])


def fit(splits, output):
    train = matrix(splits["train"])
    validation = matrix(splits["validation"])
    model = bytearray()
    for label in CLASSES:
        truth = [int(row[label]) for row in splits["train"]]
        estimator = LogisticRegression(class_weight="balanced", max_iter=400, C=0.5)
        estimator.fit(train, truth)
        weights = np.rint(estimator.coef_[0] * 128).astype("<i2")
        estimated = validation @ weights
        threshold = calibrate([int(row[label]) for row in splits["validation"]], estimated)
        model.extend(struct.pack("<i", threshold))
        model.extend(weights.tobytes())
    output.write_bytes(model)


def metrics(truth, predicted):
    tp = sum(actual and found for actual, found in zip(truth, predicted))
    fp = sum(not actual and found for actual, found in zip(truth, predicted))
    fn = sum(actual and not found for actual, found in zip(truth, predicted))
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None}


def evaluate(rows, binary):
    payload = "".join(json.dumps(row["text"], ensure_ascii=False) + "\n" for row in rows)
    process = subprocess.run([binary], input=payload, encoding="utf-8", check=True, capture_output=True)
    results = [json.loads(line) for line in process.stdout.splitlines()]
    if len(results) != len(rows):
        raise ValueError("engine returned the wrong number of rows")
    for label, category in CLASSES.items():
        truth = [int(row[label]) for row in rows]
        rules = [category in result["rules"] for result in results]
        candidates = [category in result["candidates"] for result in results]
        combined = [rule or candidate for rule, candidate in zip(rules, candidates)]
        print(json.dumps({"category": category, "rules": metrics(truth, rules),
                          "additional_candidates": metrics(truth, candidates),
                          "union_for_evaluation_only": metrics(truth, combined)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("splits", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--fit", action="store_true")
    mode.add_argument("--evaluate", type=Path, metavar="ENGINE_BINARY")
    args = parser.parse_args()
    splits = read_splits(args.splits)
    if args.fit:
        fit(splits, ROOT / "engine" / "src" / "review-model.bin")
    else:
        evaluate(splits["test"], args.evaluate.resolve())


if __name__ == "__main__":
    main()
