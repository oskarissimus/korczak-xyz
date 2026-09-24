"""The pure half of build.py, and one small end-to-end extract. Run: python -m unittest -v"""

import gzip
import json
import tempfile
import unittest
from pathlib import Path

import build

STORY_TAGS = Path(__file__).resolve().parent.parent / "korczak-xyz/src/utils/audioGuide/storyTags.json"


class Matches(unittest.TestCase):
    def test_the_three_clauses_of_the_overpass_query(self):
        self.assertTrue(build.matches({"name": "Muzeum", "tourism": "museum"}))
        self.assertTrue(build.matches({"name": "Kapliczka", "historic": "wayside_shrine"}))
        self.assertTrue(build.matches({"name": "Kościół", "amenity": "place_of_worship"}))

    def test_every_clause_needs_a_real_name(self):
        self.assertFalse(build.matches({"historic": "boundary_stone"}))
        self.assertFalse(build.matches({"name": "  ", "tourism": "museum"}))

    def test_what_the_query_leaves_out(self):
        # tourism=information is every guidepost and map board - see overpassQuery().
        self.assertFalse(build.matches({"name": "Mapa", "tourism": "information"}))
        self.assertFalse(build.matches({"name": "Hotel", "tourism": "hotel"}))
        self.assertFalse(build.matches({"name": "Szkoła", "amenity": "school"}))
        # The tourism regex is anchored: a value that only contains a listed word is not one.
        self.assertFalse(build.matches({"name": "X", "tourism": "museum;shop"}))


class Tags(unittest.TestCase):
    def test_keeps_the_story_the_names_and_nothing_else(self):
        kept = build.load_kept_tags(STORY_TAGS)
        tags = build.keep_tags(
            [("name", "Pałac"), ("name:en", "Palace"), ("name:ja", "宮殿"), ("wikidata", "Q1"),
             ("opening_hours", "Mo-Fr"), ("inscription", "x" * 1500)],
            kept,
        )
        self.assertEqual(set(tags), {"name", "name:en", "wikidata", "inscription"})
        self.assertEqual(len(tags["inscription"]), build.MAX_TAG_VALUE)


class Grid(unittest.TestCase):
    def test_matches_tiles_ts(self):
        # The same point and answer as "matches the slippy map scheme" in tiles.test.ts. If these
        # two ever disagree, a place is written into one tile and looked for in another.
        self.assertEqual((build.tile_x(21.0136, 15), build.tile_y(52.2479, 15)), (18296, 10787))

    def test_a_data_tile_is_four_by_four_of_the_apps_squares(self):
        x15, y15 = build.tile_x(21.0136, 15), build.tile_y(52.2479, 15)
        self.assertEqual((build.tile_x(21.0136, 13), build.tile_y(52.2479, 13)), (x15 >> 2, y15 >> 2))

    def test_the_edges_of_the_world(self):
        self.assertEqual(build.tile_x(-180, 13), 0)
        self.assertEqual(build.tile_x(180, 13), 2**13 - 1)
        self.assertEqual(build.tile_y(90, 13), 0)
        self.assertEqual(build.tile_y(-90, 13), 2**13 - 1)


class Centre(unittest.TestCase):
    def test_is_the_middle_of_the_bounding_box_like_out_center(self):
        box = build.BBox()
        for lat, lon in [(52.0, 21.0), (52.2, 21.1), (52.1, 21.4)]:
            box.add(lat, lon)
        lat, lon = box.centre()
        self.assertAlmostEqual(lat, 52.1)
        self.assertAlmostEqual(lon, 21.2)

    def test_an_empty_box_adds_nothing(self):
        box = build.BBox()
        box.add(1, 1)
        box.extend(build.BBox())
        self.assertEqual(box.centre(), (1, 1))


class TileBytes(unittest.TestCase):
    def test_is_an_overpass_shaped_answer(self):
        el = build.element("way", 7, 52.12345678, 21.1, {"name": "A"})
        body = json.loads(gzip.decompress(build.tile_bytes([json.dumps(el)])))
        self.assertEqual(body, {"elements": [{"type": "way", "id": 7, "lat": 52.1234568, "lon": 21.1,
                                              "tags": {"name": "A"}}]})

    def test_is_byte_identical_across_builds(self):
        self.assertEqual(build.tile_bytes(['{"a":1}']), build.tile_bytes(['{"a":1}']))


OSM_XML = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="test">
  <node id="1" version="1" lat="52.0" lon="21.0"><tag k="historic" v="memorial"/><tag k="name" v="Pomnik"/><tag k="fixme" v="x"/></node>
  <node id="2" version="1" lat="52.0" lon="21.0"/>
  <node id="3" version="1" lat="52.2" lon="21.2"/>
  <node id="4" version="1" lat="52.0" lon="21.2"/>
  <node id="5" version="1" lat="52.1" lon="21.1"><tag k="historic" v="boundary_stone"/></node>
  <node id="6" version="1" lat="50.0" lon="19.0"/>
  <node id="7" version="1" lat="50.2" lon="19.2"/>
  <way id="10" version="1"><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="amenity" v="place_of_worship"/><tag k="name" v="Kościół"/></way>
  <way id="11" version="1"><nd ref="6"/><nd ref="7"/></way>
  <relation id="20" version="1"><member type="way" ref="11" role="outer"/><tag k="type" v="multipolygon"/><tag k="tourism" v="museum"/><tag k="name" v="Muzeum"/></relation>
</osm>
"""


class Extract(unittest.TestCase):
    def test_nodes_ways_and_relations_with_their_centres(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "t.osm"
            path.write_text(OSM_XML)
            tiles = build.extract(path, build.load_kept_tags(STORY_TAGS))

        found = {f"{e['type']}/{e['id']}": e for es in tiles.values() for e in map(json.loads, es)}
        # The unnamed boundary stone and the untagged member way are not places.
        self.assertEqual(set(found), {"node/1", "way/10", "relation/20"})
        self.assertEqual(found["node/1"]["tags"], {"historic": "memorial", "name": "Pomnik"})
        self.assertEqual((found["way/10"]["lat"], found["way/10"]["lon"]), (52.1, 21.1))
        self.assertEqual((found["relation/20"]["lat"], found["relation/20"]["lon"]), (50.1, 19.1))
        for (x, y), es in tiles.items():
            for e in map(json.loads, es):
                self.assertEqual(build.file_under(e), (x, y))


if __name__ == "__main__":
    unittest.main()
