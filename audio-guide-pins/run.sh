#!/bin/bash
# What the Cloud Batch job runs, inside `python:3.12-slim-bookworm` (terraform/audio-guide-pins.tf).
#
# The job carries its own code: build.py, requirements.txt and the app's storyTags.json arrive
# base64-encoded in environment variables that Terraform fills from this directory, so the builder
# that runs on Saturday is the one on main after the last apply - no image to build and push, no
# fetch from GitHub at a commit nobody pinned.
#
# Everything goes on the boot disk under /work: the planet alone is ~95 GB, which is why the job
# asks for a 250 GB SSD boot disk and not the default 30.
set -euo pipefail

mkdir -p /work/src
cd /work/src
echo "$PINS_BUILD_PY" | base64 -d > build.py
echo "$PINS_REQUIREMENTS" | base64 -d > requirements.txt
echo "$PINS_STORY_TAGS" | base64 -d > storyTags.json

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends osmium-tool curl ca-certificates >/dev/null
pip install --quiet --no-cache-dir --root-user-action=ignore -r requirements.txt

exec python3 build.py \
  --story-tags storyTags.json \
  --work /work \
  --bucket "$PINS_BUCKET" \
  --release "$PINS_RELEASE" \
  --min-places "$PINS_MIN_PLACES"
