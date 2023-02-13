import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import { regular } from '@fortawesome/fontawesome-svg-core/import.macro'
import ContactFormWrapper from "../components/ContactForm/ContactFormWrapper"
import BigButton from "../components/BigButton";

export default function OskarTechSupport({ data }) {
    return (
        <Layout>
            <PageContent title={"Oskar Tech Support"}>
                <GatsbyImage image={getImage(data.file)} alt="Oskar Tech Support" />
                <p>
                    Oskar tech-support to cotygodniowe spotkanie na zoom dla wszystkich którzy uczą się Pythona i na czymś utknęli. Sam wiele razy robiłem tutoriale, czy podążałem krok-po-kroku za instrukcjami w jakimś kursie programowania i czasami rzeczy nie działały mimo że wszystko robiłem zgodnie z instrukcją. Wiem że takie rzeczy są frustrujące szczególnie dla początkujących. Interpreter rzuca błędem, ale w sumie nie wiadomo jak dokładnie szukać odpowiedzi.
                </p>
                <p>
                    Na codzień jestem programistą i nauczycielem/mentorem. Takie problemy to dla mnie codzienność. Czasami wystarczy kilka słów kogoś doświadczonego żeby zrozumieć jak rozwiązać problem. Podczas Oskar tech-support robimy właśnie takie rzeczy.
                </p>
                <p>
                    Nie ograniczam wsparcia programistycznego on-line tylko do uczących się Pythona. Mam również doświadczenie z JavaScriptem, Linuxem i dev-ops. Także jeśli w masz pytania w jakimkolwiek z tych zakresów, to chętnie pomogę.
                </p>
                <p>
                    Oskar tech-support to także społeczność. Jako że nie jesteśmy sami na spotkaniu, to nawet jak nie będę potrafił znaleźć odpowiedzi na pytania, to mamy resztę społeczności, a razem można więcej 🙂
                </p>
                <p>
                    Zapraszam do zapisów 🙂
                </p>

                <BigButton icon={regular("calendar")} text="Zapisz się na spotkanie" backgroundColor="bg-[#ff0000]" link="https://us06web.zoom.us/meeting/register/tZ0vcuCorj0uHdCmB6Dg8HeMCbQ12Nz9kLfO" />



                <p className="font-bold uppercase">
                    Terminy spotkań:
                </p>
                <p className="font-bold uppercase">
                    Styczeń:
                </p>
                <ul className="list-disc list-inside pl-6">
                    <MeetingDate date="23-01-2023 18:00-19:00" />
                    <MeetingDate date="30-01-2023 18:00-19:00" />
                </ul>
                <p className="font-bold uppercase">
                    Luty:
                </p>
                <ul className="list-disc list-inside pl-6">
                    <MeetingDate date="06-02-2023 18:00-19:00" />
                    <MeetingDate date="13-02-2023 18:00-19:00" />
                    <MeetingDate date="20-02-2023 18:00-19:00" />
                    <MeetingDate date="27-02-2023 18:00-19:00" />
                </ul>
                <p className="font-bold uppercase">
                    Marzec:
                </p>
                <ul className="list-disc list-inside pl-6">
                    <MeetingDate date="06-03-2023 18:00-19:00" />
                    <MeetingDate date="13-03-2023 18:00-19:00" />
                    <MeetingDate date="20-03-2023 18:00-19:00" />
                    <MeetingDate date="27-03-2023 18:00-19:00" />

                </ul>


                <ContactFormWrapper />

            </PageContent>
        </Layout>
    )
}

function MeetingDate({ date }) {
    const dayPart = date.substring(0, 2);
    const rest = date.substring(2);

    return (
        <li>
            <span className="font-bold">{dayPart}</span>
            <span>{rest}</span>
        </li>
    )
}

export const query = graphql`
query OskarTechSupportColorImage {
    file(relativePath: {eq: "oskar-tech-support-color.png"}) {
        id
        childImageSharp {
            gatsbyImageData
        }
    }
}
`