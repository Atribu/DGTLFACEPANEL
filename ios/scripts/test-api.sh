#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ios_directory=$(dirname -- "$script_directory")
test_directory=$(mktemp -d "${TMPDIR:-/tmp}/dgtlface-panel-api-tests.XXXXXX")
trap 'rm -rf "$test_directory"' EXIT HUP INT TERM

swiftc -swift-version 6 \
  "$ios_directory/DGTLFACEChecklist/PanelModels.swift" \
  "$ios_directory/DGTLFACEChecklist/PanelAdminModels.swift" \
  "$ios_directory/DGTLFACEChecklist/PanelAPI.swift" \
  "$ios_directory/Tests/PanelAPITests.swift" \
  -o "$test_directory/panel-api-tests"
"$test_directory/panel-api-tests"
