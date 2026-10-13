#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ios_directory=$(dirname -- "$script_directory")
test_directory=$(mktemp -d "${TMPDIR:-/tmp}/dgtlface-checklist-tests.XXXXXX")
trap 'rm -rf "$test_directory"' EXIT HUP INT TERM

swiftc -swift-version 6 \
  "$ios_directory/DGTLFACEChecklist/ChecklistCore.swift" \
  "$ios_directory/Tests/ChecklistCoreTests.swift" \
  -o "$test_directory/checklist-core-tests"
"$test_directory/checklist-core-tests" \
  "$ios_directory/DGTLFACEChecklist/Resources/checklist.json"
