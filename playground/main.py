def chromatic_note_to_note(chromatic_note: int, sharp=True) -> str:
    if sharp:
        notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    else:
        notes = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
    return notes[chromatic_note % 12]


def chromatic_scale_to_notes(
    chromatic: list[bool], sharp=True, start_from=0
) -> list[str]:
    return [
        chromatic_note_to_note((i + start_from) % 12, sharp)
        for i, is_note in enumerate(chromatic)
        if is_note
    ]


def transpose(chromatic: list[bool], steps: int) -> list[bool]:
    return chromatic[-steps:] + chromatic[:-steps]


def main():
    c_major = [
        True,
        False,
        True,
        False,
        True,
        True,
        False,
        True,
        False,
        True,
        False,
        True,
    ]
    scale = c_major
    first = 0
    print(f"{chromatic_scale_to_notes(first)} {chromatic_scale_to_notes(scale)}")
    for step in range(12):
        scale = transpose(scale, 7)
        first = first + 7 % 12
        sharp = step < 5
        print(
            f"{chromatic_scale_to_notes(first, sharp)} {chromatic_scale_to_notes(scale, sharp, first)}"
        )


if __name__ == "__main__":
    main()
