import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { StaticImage } from "gatsby-plugin-image"
import ContactFormWrapper from "../components/ContactForm/ContactFormWrapper"
import { Seo } from "../components/Seo"
import { icon } from '@fortawesome/fontawesome-svg-core/import.macro'
import BigButton from "../components/BigButton";
import Countdown from 'react-countdown';

export const Head = () => (
    <Seo />
)

function dateOfNextMonday(dest_hour, dest_minutes) {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();
    const d = new Date(now.getTime() + (8 - day) * 24 * 60 * 60 * 1000 + (dest_hour - hour) * 60 * 60 * 1000 + (dest_minutes - minutes) * 60 * 1000 + (0 - seconds) * 1000 + (0 - milliseconds));
    return d
}

function dateOfNextLiveBegin() {
    return dateOfNextMonday(16, 30)
}
function dateOfNextLiveEnd() {
    return dateOfNextMonday(17, 30)
}

function itsLiveTime() {
    return new Date() > dateOfNextLiveBegin() && new Date() < dateOfNextLiveEnd()
    // return true
}

function formatCountdown({ days, hours, minutes, seconds }) {
    return `${days} Days ${hours} Hours ${minutes} Minutes ${seconds} Seconds`
}

export default function OskarLive() {
    return (
        <Layout>
            <PageContent title={"Oskar live"}>
                <StaticImage src="../images/oskar-live.png" alt="Oskar Tech Support" />
                <p>
                    I am streaming weekly on mondays 16:30-17:30 CEST on zoom
                    and on YouTube
                    where I am working on my projects and answering questions.
                </p>
                <div className="flex justify-center my-10">
                    {itsLiveTime() && <div className="text-green-500 text-6xl">Live now!</div >}
                    {itsLiveTime() || <div>
                        time to next stream:
                        <div className="text-red-500 text-3xl">
                            <Countdown
                                date={dateOfNextLiveBegin()}
                                renderer={formatCountdown}
                            />
                        </div>
                    </div>
                    }
                </div>
                <div className="flex gap-4">

                    <BigButton
                        icon={icon({ name: "right-to-bracket" })}
                        text="Join on Zoom"
                        backgroundColor="bg-[#0000ff]"
                        link="https://us06web.zoom.us/j/81325961194?pwd=aUlhRTlFMUZiZnNqRmpQcitqcHVoZz09"
                    />
                    <BigButton
                        icon={icon({
                            name: "youtube", style: "brands"
                        })}
                        text="Join on YouTube"
                        backgroundColor="bg-[#ff0000]"
                        link="https://www.youtube.com/channel/@korczakxyz"
                    />
                </div>

                <ContactFormWrapper />

            </PageContent>
        </Layout>
    )
}
