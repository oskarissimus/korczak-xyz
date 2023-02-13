import { Link } from "gatsby";
import React from "react";
import Layout from "../../components/Layout"
import PageContent from "../../components/PageContent"
import { graphql } from "gatsby";
import { GatsbyImage, getImage } from "gatsby-plugin-image"



function CourseSection({ title, image, description, link }) {
    return (
        <div className="flex flex-col gap-8" >
            <h3 className="text-4xl">
                {title}
            </h3>
            <GatsbyImage image={getImage(image)} alt={title} />
            <p>{description}</p>
            <div>
                <RedButton text="Dowiedz się więcej" link={link} />
            </div>
        </div >
    )
}

function RedButton({ text, link }) {
    return (
        <Link className="bg-red-500 hover:bg-red-400 text-white py-4 px-6" to={link}>
            {text}
        </Link>

    )
}

export default function Courses({ data }) {
    const courses = [
        {
            title: "Zaawansowane narzędzia web-testera",
            image: data.allFile.nodes.filter(node => node.name === "zaawansowane-narzedzia-web-testera-color")[0].childImageSharp.gatsbyImageData,
            description: "Na kurs składa się 12 1-godzinnych indywidualnych spotkań z kursantem. Terminy spotkań są ustalane indywidualnie. Celem kursu jest zapoznanie z zaawansowanymi narzędziami stosowanymi w pracy web-testera. Oprócz materiału omawianego podczas spotkań prowadzący przedstawia również dodatkowe materiały do pracy własnej, które mają na celu utrwalić wiedzę i umiejętności kursanta.",
            link: "/courses/kurs-zaawansowane-narzedzia-web-testera/",
        },
        {
            title: "Wybrane aspekty sieciowe",
            image: data.allFile.nodes.filter(node => node.name === "wybrane-aspekty-sieciowe-color")[0].childImageSharp.gatsbyImageData,
            description: "Kurs ma na celu przybliżyć deweloperom wybrane aspekty sieciowe w praktyczny sposób. Zagadnienia są wybrane w taki sposób, aby kompleksowo omówić informacje potrzebne żeby skutecznie działać jako full-stack developer z pełną kontrolą nad sieciowością aplikacji.",
            link: "/courses/kurs-wybrane-aspekty-sieciowe/",
        },
        {
            title: "Programowanie backend w JS",
            image: data.allFile.nodes.filter(node => node.name === "programowanie-backend-w-js-color")[0].childImageSharp.gatsbyImageData,
            description: "Kurs jest przeznaczony dla rozpoczynających swoją przygodę z programowaniem. Kurs jest podzielony pięć części: programistyczne abecadło, zaawansowane aspekty języka, typescript, narzędzia backendowe w JS, projekt programistyczny. Każda z tych części jest opisana niżej. Na kurs składają się zarówno spotkania z mentorem jak i praca własna kursanta pomiędzy spotkaniami.",
            link: "/courses/kurs-programowanie-backend-w-js/",
        }
    ]
    console.log(data)
    return (
        <Layout>
            <PageContent title="Courses">
                <div className="flex flex-col gap-20" >
                    {courses.map((course, index) => (
                        <CourseSection key={index} {...course} />
                    ))}
                </div>
            </PageContent>
        </Layout>
    )
}
export const query = graphql`
query CoursesColorImages {
    allFile(filter: {relativeDirectory: {eq: "courses"}}) {
        nodes {
            name
            childImageSharp {
                gatsbyImageData
            }
        }
    }
}
`
