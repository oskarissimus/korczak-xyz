import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { StaticImage } from "gatsby-plugin-image"
import ContactFormWrapper from "../components/ContactForm/ContactFormWrapper"
import { Seo } from "../components/Seo"
import { icon } from '@fortawesome/fontawesome-svg-core/import.macro'
import BigButton from "../components/BigButton";
import Countdown from 'react-countdown';
import { graphql } from "gatsby";
import { Trans, useTranslation } from 'gatsby-plugin-react-i18next';
import parser from "cron-parser"

export const Head = () => (
    <Seo />
)

function dateOfNextLiveBegin() {
    return parser.parseExpression("30 16 * * 1").next().toDate()
}

function dateOfNextLiveEnd() {
    return parser.parseExpression("30 17 * * 1").next().toDate()
}

function itsLiveTime() {
    const nextLiveBegin = dateOfNextLiveBegin()
    const nextLiveEnd = dateOfNextLiveEnd()
    return nextLiveBegin > nextLiveEnd
}

function FormatCountdown({ days, hours, minutes, seconds }) {
    return (
        <>
            {days} <Trans>Days</Trans> {hours} <Trans>Hours</Trans> {minutes} <Trans>Minutes</Trans> {seconds} <Trans>Seconds</Trans>
        </>
    )
}

export default function OskarLive() {
    const { t } = useTranslation();
    return (
        <Layout>
            <PageContent title={"Oskar live"}>
                <StaticImage
                    src="../images/oskar-live.png"
                    alt="Oskar Live"
                    layout="fullWidth"
                />
                <p>
                    <Trans>
                        I am streaming weekly on mondays 16:30-17:30 CEST on zoom and on YouTube where I am working on my projects and answering questions.
                    </Trans>
                </p>
                <div className="flex justify-center my-10">
                    {itsLiveTime() && <div className="text-green-500 text-6xl"><Trans>Live now!</Trans></div>}
                    {itsLiveTime() || <div>
                        <Trans>time to next stream:</Trans>
                        <div className="text-red-500 text-3xl">
                            <Countdown
                                date={dateOfNextLiveBegin()}
                                renderer={FormatCountdown}
                            />
                        </div>
                    </div>
                    }
                </div>
                <div className="flex gap-4 flex-col sm:flex-row">

                    <BigButton
                        icon={icon({ name: "right-to-bracket" })}
                        text={t("Join on Zoom")}
                        backgroundColor="bg-[#0000ff]"
                        to="https://us06web.zoom.us/j/81325961194?pwd=aUlhRTlFMUZiZnNqRmpQcitqcHVoZz09"
                    />
                    <BigButton
                        icon={icon({
                            name: "youtube", style: "brands"
                        })}
                        text={t("Join on YouTube")}
                        backgroundColor="bg-[#ff0000]"
                        to="https://www.youtube.com/@korczakxyz/streams"
                    />
                </div>

                <ContactFormWrapper />

            </PageContent>
        </Layout>
    )
}
export const query = graphql`
  query ($language: String!) {
    locales: allLocale(filter: {language: {eq: $language}}) {
      edges {
        node {
          ns
          data
          language
        }
      }
    }
  }
`;