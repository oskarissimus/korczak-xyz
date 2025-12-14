#!/bin/bash
set -e

# Validation script for Gatsby to Astro migration
# Compares cleaned HTML snapshots between Gatsby and Astro sites

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ASTRO_DIR="$ROOT_DIR/astro-site"
CRAWLER_DIR="$ROOT_DIR/snapshot-crawler"
GATSBY_SNAPSHOTS="$CRAWLER_DIR/snapshots/gatsby"
ASTRO_SNAPSHOTS="$CRAWLER_DIR/snapshots/astro"

echo "=== Gatsby to Astro Migration Validation ==="
echo ""

# Check if Gatsby snapshots exist
if [ ! -d "$GATSBY_SNAPSHOTS" ]; then
    echo "ERROR: Gatsby snapshots not found at $GATSBY_SNAPSHOTS"
    echo "Please run the crawler on the Gatsby site first."
    exit 1
fi

# Build Astro site
echo "Step 1: Building Astro site..."
cd "$ASTRO_DIR"
npm run build

# Start Astro preview server in background
echo ""
echo "Step 2: Starting Astro preview server..."
npm run preview &
PREVIEW_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
sleep 3

# Check if server is running
if ! curl -s http://localhost:4321 > /dev/null; then
    echo "ERROR: Preview server failed to start"
    kill $PREVIEW_PID 2>/dev/null || true
    exit 1
fi

echo "Server is running on http://localhost:4321"

# Crawl Astro site
echo ""
echo "Step 3: Crawling Astro site..."
cd "$CRAWLER_DIR"

# Remove old Astro snapshots if they exist
if [ -d "$ASTRO_SNAPSHOTS" ]; then
    rm -rf "$ASTRO_SNAPSHOTS"
fi

node crawler.js --url http://localhost:4321 --output "$ASTRO_SNAPSHOTS" --clean

# Stop preview server
echo ""
echo "Step 4: Stopping preview server..."
kill $PREVIEW_PID 2>/dev/null || true

# Compare snapshots
echo ""
echo "Step 5: Comparing snapshots..."
echo ""

# Count files
GATSBY_COUNT=$(find "$GATSBY_SNAPSHOTS" -name "*.html" | wc -l | tr -d ' ')
ASTRO_COUNT=$(find "$ASTRO_SNAPSHOTS" -name "*.html" | wc -l | tr -d ' ')

echo "Gatsby pages: $GATSBY_COUNT"
echo "Astro pages: $ASTRO_COUNT"
echo ""

# Check for missing pages
echo "Checking for missing pages..."
MISSING=0
for file in "$GATSBY_SNAPSHOTS"/*.html; do
    filename=$(basename "$file")
    if [ ! -f "$ASTRO_SNAPSHOTS/$filename" ]; then
        echo "  MISSING in Astro: $filename"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -eq 0 ]; then
    echo "  All Gatsby pages are present in Astro."
fi

# Check for extra pages
EXTRA=0
for file in "$ASTRO_SNAPSHOTS"/*.html; do
    filename=$(basename "$file")
    if [ ! -f "$GATSBY_SNAPSHOTS/$filename" ]; then
        echo "  EXTRA in Astro: $filename"
        EXTRA=$((EXTRA + 1))
    fi
done

if [ $EXTRA -eq 0 ]; then
    echo "  No extra pages in Astro."
fi

# Run diff
echo ""
echo "Running diff comparison..."
echo ""

DIFF_OUTPUT=$(diff -r "$GATSBY_SNAPSHOTS" "$ASTRO_SNAPSHOTS" 2>&1 || true)

if [ -z "$DIFF_OUTPUT" ]; then
    echo "SUCCESS: No differences found between Gatsby and Astro snapshots!"
    echo ""
    echo "Migration validation complete - sites are identical."
    exit 0
else
    echo "DIFFERENCES FOUND:"
    echo ""
    echo "$DIFF_OUTPUT" | head -100

    # Count differences
    DIFF_COUNT=$(echo "$DIFF_OUTPUT" | grep -c "^diff" || true)
    echo ""
    echo "Total files with differences: $DIFF_COUNT"
    echo ""
    echo "For detailed comparison, run:"
    echo "  diff -r $GATSBY_SNAPSHOTS $ASTRO_SNAPSHOTS"
    exit 1
fi
