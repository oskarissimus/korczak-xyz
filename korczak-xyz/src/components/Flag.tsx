import React from 'react';
import ReactCountryFlag from "react-country-flag";
const emojiSupport = require("detect-emoji-support");

interface FlagProps {
    lng: string;
}

const langToCountryCode: { [key: string]: string } = {
    en: 'GB',
    pl: 'PL'
}

const langToFlagEmoji: { [key: string]: string } = {
    en: '🇬🇧',
    pl: '🇵🇱'
}

export default function Flag({ lng }: FlagProps): JSX.Element {
    console.log("emojiSupport in component:", emojiSupport());
    if (emojiSupport()) {
      return (
        <span role="img" aria-label={lng} className="text-2xl">
          {langToFlagEmoji[lng]}
        </span>
      );
    }
    return (
      <ReactCountryFlag
        countryCode={langToCountryCode[lng]}
        svg
        className="text-2xl"
        data-testid="fallback-flag"
      />
    );
  }
  