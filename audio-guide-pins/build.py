#!/usr/bin/env python3
"""
The audio guide's pins, built once a week for the whole world instead of asked for on every pan.

The map used to ask Overpass - a free, shared, IP-rate-limited public server - for the pins in
every rectangle it had not seen yet, and waited seconds to tens of seconds for each answer. But
the app only ever asks one question: named museums, attractions, galleries, viewpoints, artwork,
historic things and places of worship, with a fixed list of tags. So this answers that question
for the whole planet in advance and writes the answer as one PMTiles archive, which the browser
reads a tile at a time with HTTP range requests.

In order:

  1. download the planet (~95 GB) from a mirror,
  2. `osmium tags-filter` it down to the three kinds of thing the Overpass query asks for, with
     the nodes and ways they are made of (a few GB),
  3. read that with pyosmium: apply the rest of the query (`["name"]`, the tourism values), give
     every way and relation the centre Overpass's `out center` would, keep the story tags,
  4. file every place under the zoom-13 tile its point falls in and write one gzipped JSON tile
     per non-empty tile - `{"elements": [...]}`, the same shape as an Overpass answer, so the
     browser's `transformAttractions` reads both,
  5. upload the archive under a new name, then point `latest.json` at it, then delete all but
     the previous one.

It runs as a Cloud Batch job on a spot VM (terraform/audio-guide-pins.tf) and reports its own
failure to Sentry, because a build that fails every week while the app keeps serving an old
archive is the one way this can go wrong quietly.

Only the pure half - matching, centres, tiles, the tile bytes - is unit tested
(test_build.py); the rest is subprocesses and HTTP.
"""

from __future__ import annotations

import argparse
import datetime
import gzip
import json
import math
import os
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Iterable, Mapping

# The tile zoom of the archive. The browser's cache is keyed by zoom-15 squares (tiles.ts), and
# one zoom-13 tile is exactly 4x4 of those, so a tile read out of the archive answers sixteen
# squares at once. Coarser would make a dense old town's tile hundreds of kilobytes; finer would
# make a phone at the map's minimum zoom (13) ask for dozens of tiles per screen.
DATA_ZOOM = 13

# The Overpass query, in overpass.ts, which this must stay in step with:
#   nwr["tourism"~"^(museum|attraction|gallery|viewpoint|artwork)$"]["name"]
#   nwr["historic"]["name"]
#   nwr["amenity"="place_of_worship"]["name"]
TOURISM = frozenset({"museum", "attraction", "gallery", "viewpoint", "artwork"})

# What osmium keeps from the planet before Python sees any of it. Deliberately wider than the
# query - osmium cannot say "and has a name" - so `matches` finishes the job.
OSMIUM_FILTER = [
    "nwr/tourism=" + ",".join(sorted(TOURISM)),
    "nwr/historic",
    "nwr/amenity=place_of_worship",
]

# Web Mercator stops here, and so does tiles.ts.
MAX_LAT = 85.05112878

# The function behind the guide refuses a tag value over a thousand characters; storyTags() in
# overpass.ts cuts to the same length. Cut here too, so the archive does not carry what the app
# will throw away.
MAX_TAG_VALUE = 1000

PLANET_MIRRORS = [
    "https://ftp.fau.de/osm-planet/pbf/planet-latest.osm.pbf",
    "https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
]

# The functions' Sentry project, `korczak-xyz-functions`: this is backend work that runs at 4am
# with nobody watching, which is what that project is for. A DSN is a public credential.
SENTRY_ENVELOPE_URL = "https://o4512114964430848.ingest.de.sentry.io/api/4512115029573712/envelope/"
SENTRY_KEY = "3f048444dd9366925531ca09ce09737d"

USER_AGENT = "korczak.xyz audio-guide-pins (https://korczak.xyz/apps/audio-guide/)"


def log(message: str) -> None:
    print(f"[{datetime.datetime.now(datetime.timezone.utc):%H:%M:%S}] {message}", flush=True)


# --- The pure half ---------------------------------------------------------------------------


def load_kept_tags(path: Path) -> frozenset[str]:
    """The tags a pin carries: the story tags, the handful of other-language names, and `name`."""
    data = json.loads(path.read_text())
    return frozenset(data["story"]) | {f"name:{lang}" for lang in data["nameLanguages"]} | {"name"}


def matches(tags: Mapping[str, str]) -> bool:
    """Whether the Overpass query would return this element, and the app would keep it.

    `["name"]` in Overpass is "has the key"; transformAttractions then drops a name that is only
    whitespace. Both are applied here, so the archive holds exactly what the app would draw.
    """
    name = tags.get("name")
    if name is None or not name.strip():
        return False
    return (
        tags.get("tourism") in TOURISM
        or "historic" in tags
        or tags.get("amenity") == "place_of_worship"
    )


def keep_tags(tags: Iterable[tuple[str, str]], kept: frozenset[str]) -> dict[str, str]:
    return {k: v[:MAX_TAG_VALUE] for k, v in tags if k in kept}


def _clamp(i: int, n: int) -> int:
    return max(0, min(n - 1, i))


def tile_x(lon: float, zoom: int) -> int:
    """The same arithmetic as tileX in tiles.ts, so a place lands in the square the app expects."""
    n = 2**zoom
    return _clamp(math.floor(((max(-180.0, min(180.0, lon)) + 180) / 360) * n), n)


def tile_y(lat: float, zoom: int) -> int:
    """The same arithmetic as tileY in tiles.ts."""
    n = 2**zoom
    rad = max(-MAX_LAT, min(MAX_LAT, lat)) * math.pi / 180
    return _clamp(math.floor(((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2) * n), n)


class BBox:
    """A running bounding box, which is all Overpass's `out center` is the middle of."""

    __slots__ = ("south", "west", "north", "east")

    def __init__(self) -> None:
        self.south = math.inf
        self.west = math.inf
        self.north = -math.inf
        self.east = -math.inf

    def add(self, lat: float, lon: float) -> None:
        self.south = min(self.south, lat)
        self.north = max(self.north, lat)
        self.west = min(self.west, lon)
        self.east = max(self.east, lon)

    def extend(self, other: "BBox") -> None:
        if other.empty:
            return
        self.add(other.south, other.west)
        self.add(other.north, other.east)

    @property
    def empty(self) -> bool:
        return self.south == math.inf

    def centre(self) -> tuple[float, float]:
        return (self.south + self.north) / 2, (self.west + self.east) / 2


def element(kind: str, osm_id: int, lat: float, lon: float, tags: dict[str, str]) -> dict:
    """One place, in the shape of an Overpass element.

    Coordinates are rounded to OSM's own precision, and the tile is computed from the ROUNDED
    value (see `file_under`): that is the number the browser will read back and file by, so a
    place on a tile edge cannot be written into one tile and looked for in its neighbour.
    """
    return {"type": kind, "id": osm_id, "lat": round(lat, 7), "lon": round(lon, 7), "tags": tags}


def file_under(el: dict) -> tuple[int, int]:
    return tile_x(el["lon"], DATA_ZOOM), tile_y(el["lat"], DATA_ZOOM)


def tile_bytes(elements: list[str]) -> bytes:
    """A tile: `{"elements": [...]}`, gzipped, with no timestamp so a rebuild is byte-identical."""
    body = '{"elements":[' + ",".join(elements) + "]}"
    return gzip.compress(body.encode(), mtime=0)


# --- Reading the filtered extract --------------------------------------------------------------


def extract(path: Path, kept: frozenset[str]) -> dict[tuple[int, int], list[str]]:
    """Every place in a (filtered) OSM file, serialised and filed by zoom-13 tile.

    Two passes, because a relation's centre needs its members' positions and a relation comes
    after the ways it is made of in the file:

      1. relations: the ones that match, and the ids of their member nodes and ways,
      2. nodes and ways, with node locations: matching nodes and ways out directly, and the
         bounding boxes of the relation members remembered.

    Sub-relations are not followed. A church whose outline is a relation of relations is rare,
    and Overpass's own centre for one is the middle of whatever it reaches, which is the same
    building either way.
    """
    import osmium  # Imported here so the pure half is testable without it.

    tiles: dict[tuple[int, int], list[str]] = {}
    count = 0

    def emit(el: dict) -> None:
        nonlocal count
        tiles.setdefault(file_under(el), []).append(json.dumps(el, ensure_ascii=False, separators=(",", ":")))
        count += 1

    relations: dict[int, tuple[dict[str, str], list[int], list[int]]] = {}
    member_nodes: set[int] = set()
    member_ways: set[int] = set()

    for rel in osmium.FileProcessor(str(path), osmium.osm.RELATION):
        if not matches(rel.tags):
            continue
        nodes = [m.ref for m in rel.members if m.type == "n"]
        ways = [m.ref for m in rel.members if m.type == "w"]
        relations[rel.id] = (keep_tags(((t.k, t.v) for t in rel.tags), kept), nodes, ways)
        member_nodes.update(nodes)
        member_ways.update(ways)
    log(f"relations: {len(relations)} match")

    node_at: dict[int, tuple[float, float]] = {}
    way_box: dict[int, BBox] = {}

    fp = osmium.FileProcessor(str(path), osmium.osm.NODE | osmium.osm.WAY).with_locations()
    for obj in fp:
        if obj.is_node():
            if not obj.location.valid():
                continue
            if obj.id in member_nodes:
                node_at[obj.id] = (obj.location.lat, obj.location.lon)
            if obj.tags and matches(obj.tags):
                emit(element("node", obj.id, obj.location.lat, obj.location.lon,
                             keep_tags(((t.k, t.v) for t in obj.tags), kept)))
        else:
            is_member = obj.id in member_ways
            is_place = matches(obj.tags)
            if not is_member and not is_place:
                continue
            box = BBox()
            for n in obj.nodes:
                if n.location.valid():
                    box.add(n.location.lat, n.location.lon)
            if box.empty:
                continue
            if is_member:
                way_box[obj.id] = box
            if is_place:
                lat, lon = box.centre()
                emit(element("way", obj.id, lat, lon, keep_tags(((t.k, t.v) for t in obj.tags), kept)))

    for rel_id, (tags, nodes, ways) in relations.items():
        box = BBox()
        for n in nodes:
            if n in node_at:
                box.add(*node_at[n])
        for w in ways:
            if w in way_box:
                box.extend(way_box[w])
        if box.empty:
            continue
        lat, lon = box.centre()
        emit(element("relation", rel_id, lat, lon, tags))

    log(f"places: {count} in {len(tiles)} tiles")
    return tiles


def write_archive(tiles: dict[tuple[int, int], list[str]], out: Path, metadata: dict) -> None:
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    # In tile-id order, which is what makes the archive "clustered": a tile's neighbours are its
    # neighbours on disk, and a reader's range requests stay short.
    order = sorted(tiles, key=lambda xy: zxy_to_tileid(DATA_ZOOM, xy[0], xy[1]))
    with out.open("wb") as f:
        writer = Writer(f)
        for x, y in order:
            writer.write_tile(zxy_to_tileid(DATA_ZOOM, x, y), tile_bytes(tiles[(x, y)]))
        writer.finalize(
            {
                "tile_type": TileType.UNKNOWN,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": -1800000000,
                "min_lat_e7": -850511287,
                "max_lon_e7": 1800000000,
                "max_lat_e7": 850511287,
                "center_zoom": DATA_ZOOM,
                "center_lon_e7": 210122000,
                "center_lat_e7": 522297000,
            },
            metadata,
        )


# --- Downloading, filtering, uploading ----------------------------------------------------------


def run(*args: str) -> str:
    log("$ " + " ".join(args))
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def download_planet(dest: Path) -> str:
    """The planet, from the first mirror that answers. Returns the URL it came from."""
    for url in PLANET_MIRRORS:
        try:
            # curl rather than urllib: resumable on a flaky connection (-C -), and it will say
            # plainly how far it got. --fail so an HTML error page is not mistaken for a planet.
            subprocess.run(
                ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "5",
                 "--retry-all-errors", "-C", "-", "-A", USER_AGENT, "-o", str(dest), url],
                check=True,
            )
            log(f"planet: {dest.stat().st_size / 1e9:.1f} GB from {url}")
            return url
        except subprocess.CalledProcessError as e:
            log(f"planet: {url} failed ({e.returncode})")
            dest.unlink(missing_ok=True)
    raise RuntimeError("no planet mirror answered")


def planet_timestamp(path: Path) -> str | None:
    try:
        value = run("osmium", "fileinfo", "--no-progress", "-g",
                    "header.option.osmosis_replication_timestamp", str(path)).strip()
        return value or None
    except subprocess.CalledProcessError:
        return None


def metadata_token() -> str:
    request = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)["access_token"]


def upload(bucket: str, name: str, path: Path, content_type: str, cache_control: str) -> None:
    """One object, as a single-chunk resumable upload - the only kind that takes metadata and
    streams the body from disk, and the archive is a few hundred megabytes."""
    token = metadata_token()
    start = urllib.request.Request(
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=resumable",
        data=json.dumps({"name": name, "contentType": content_type, "cacheControl": cache_control}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(start, timeout=60) as response:
        session = response.headers["Location"]

    size = path.stat().st_size
    with path.open("rb") as body:
        put = urllib.request.Request(
            session, data=body, method="PUT",
            headers={"Content-Length": str(size), "Content-Type": content_type},
        )
        with urllib.request.urlopen(put, timeout=1800) as response:
            response.read()
    log(f"uploaded gs://{bucket}/{name} ({size / 1e6:.1f} MB)")


def prune(bucket: str, keep: set[str]) -> None:
    """Delete every archive but the new one and the one before it.

    The previous one survives because a page opened before this build still has its name, and is
    reading ranges out of it; `latest.json` is cached for five minutes, so an archive deleted the
    moment it is replaced would break every map open across the switch. Pruned by name rather than
    by a lifecycle age rule because an age rule would, after a month of failed builds, delete the
    only archive there is.
    """
    token = metadata_token()
    request = urllib.request.Request(
        f"https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix=pins-&fields=items(name)",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        names = [item["name"] for item in json.load(response).get("items", [])]
    for name in names:
        if name in keep:
            continue
        delete = urllib.request.Request(
            f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{urllib.parse.quote(name, safe='')}",
            headers={"Authorization": f"Bearer {token}"},
            method="DELETE",
        )
        urllib.request.urlopen(delete, timeout=60).read()
        log(f"deleted gs://{bucket}/{name}")


def previous_archive(bucket: str) -> str | None:
    try:
        with urllib.request.urlopen(f"https://storage.googleapis.com/{bucket}/latest.json", timeout=30) as r:
            return json.load(r).get("archive")
    except Exception:
        return None


def report_failure(error: BaseException, release: str) -> None:
    """Best effort: a build that cannot report its failure has still failed, and says so in the log."""
    try:
        event_id = uuid.uuid4().hex
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        event = {
            "event_id": event_id,
            "timestamp": now,
            "platform": "python",
            "level": "error",
            "logger": "audio-guide-pins",
            "release": release,
            "environment": "production",
            "fingerprint": ["audio-guide-pins.build.failed"],
            "tags": {"context": "audio-guide-pins"},
            "exception": {"values": [{"type": type(error).__name__, "value": str(error)[:2000]}]},
            "extra": {"traceback": traceback.format_exc()[-8000:]},
        }
        envelope = "\n".join([
            json.dumps({"event_id": event_id, "sent_at": now}),
            json.dumps({"type": "event"}),
            json.dumps(event),
        ]) + "\n"
        request = urllib.request.Request(
            f"{SENTRY_ENVELOPE_URL}?sentry_key={SENTRY_KEY}&sentry_version=7",
            data=envelope.encode(),
            headers={"Content-Type": "application/x-sentry-envelope"},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=10).read()
    except Exception as e:  # noqa: BLE001 - there is nowhere left to report this
        log(f"could not report to Sentry: {e}")


def build(args: argparse.Namespace) -> None:
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    kept = load_kept_tags(Path(args.story_tags))
    started = time.monotonic()

    if args.input:
        source, source_url = Path(args.input), args.input
    else:
        source = work / "planet.osm.pbf"
        source_url = download_planet(source)

    filtered = work / "filtered.osm.pbf"
    run("osmium", "tags-filter", "--no-progress", "--overwrite", "-o", str(filtered), str(source), *OSMIUM_FILTER)
    log(f"filtered: {filtered.stat().st_size / 1e6:.0f} MB")
    planet = planet_timestamp(source)
    if not args.input and not args.keep_planet:
        source.unlink()

    tiles = extract(filtered, kept)
    if not tiles:
        raise RuntimeError("the extract holds no places at all - refusing to publish an empty archive")
    places = sum(len(v) for v in tiles.values())
    if places < args.min_places:
        raise RuntimeError(f"only {places} places, fewer than --min-places={args.min_places}; not publishing")

    built = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    name = f"pins-{built:%Y%m%d-%H%M%S}.pmtiles"
    archive = work / name
    write_archive(tiles, archive, {
        "name": "audio-guide-pins",
        "description": "Named places for the korczak.xyz audio guide, one gzipped JSON tile per zoom-13 tile.",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "dataZoom": DATA_ZOOM,
        "planet": planet,
        "source": source_url,
        "built": built.isoformat().replace("+00:00", "Z"),
        "release": args.release,
        "places": places,
    })
    log(f"archive: {archive.stat().st_size / 1e6:.1f} MB, {len(tiles)} tiles, {places} places")

    if not args.bucket:
        log(f"no --bucket; archive left at {archive}")
        return

    before = previous_archive(args.bucket)
    upload(args.bucket, name, archive, "application/vnd.pmtiles", "public, max-age=31536000, immutable")
    pointer = work / "latest.json"
    pointer.write_text(json.dumps({
        "archive": name,
        "built": built.isoformat().replace("+00:00", "Z"),
        "planet": planet,
        "places": places,
        "release": args.release,
    }))
    upload(args.bucket, "latest.json", pointer, "application/json", "public, max-age=300")
    prune(args.bucket, {name} | ({before} if before else set()))
    log(f"done in {(time.monotonic() - started) / 60:.0f} min")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--story-tags", required=True, help="korczak-xyz/src/utils/audioGuide/storyTags.json")
    parser.add_argument("--work", default="/work", help="scratch directory; the planet alone is ~95 GB")
    parser.add_argument("--bucket", help="GCS bucket to publish to; omit to build locally only")
    parser.add_argument("--input", help="a local .osm.pbf to build from instead of downloading the planet")
    parser.add_argument("--keep-planet", action="store_true", help="do not delete the downloaded planet")
    parser.add_argument("--release", default=os.environ.get("PINS_RELEASE", "dev"))
    # A planet build that comes out with a fraction of the world is a broken filter or a truncated
    # download, not a quiet week in OpenStreetMap - and publishing it would empty the map
    # everywhere at once. The world has millions of these places.
    parser.add_argument("--min-places", type=int, default=0)
    args = parser.parse_args()

    try:
        build(args)
        return 0
    except BaseException as e:  # noqa: BLE001 - reported, then re-raised as a failed exit
        log(f"FAILED: {e!r}")
        traceback.print_exc()
        if args.bucket:
            report_failure(e, args.release)
        return 1


if __name__ == "__main__":
    sys.exit(main())
