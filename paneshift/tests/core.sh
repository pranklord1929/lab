#!/usr/bin/env bash
# Runs the PaneShiftCore unit tests.
#
# The repository lives under ~/Desktop, which iCloud Drive syncs. Its file
# provider stamps `com.apple.FinderInfo` on newly created bundle directories,
# and `codesign` refuses to sign anything carrying it:
#
#   PaneShiftCoreTests.xctest: resource fork, Finder information, or similar
#   detritus not allowed
#
# That is why `swift test` appeared broken on this machine. `xattr -c` does not
# help: the attribute comes back as soon as the bundle is rebuilt in place.
# Building into a directory outside the synced tree removes the cause.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${PANESHIFT_SCRATCH_PATH:-$HOME/Library/Caches/PaneShift/build}"

mkdir -p "$SCRATCH"
exec swift test --package-path "$ROOT" --scratch-path "$SCRATCH" "$@"
