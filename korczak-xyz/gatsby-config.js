/**
 * Configure your Gatsby site with this file.
 *
 * See: https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/
 */

/**
 * @type {import('gatsby').GatsbyConfig}
 */
module.exports = {
  // flags: {
  //   DEV_SSR: true
  // },
  plugins: ['gatsby-plugin-postcss',
    `gatsby-plugin-image`,
    `gatsby-plugin-sharp`,
    `gatsby-transformer-sharp`,
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        // The unique name for each instance
        name: `images`,
        // Path to the directory
        path: `${__dirname}/src/images/`,
      },
    },
  ],
  siteMetadata: {
    title: `korczak.xyz`,
    description: `Personal website of Oskar Korczak`,
    image: `/logo.png`,
    siteUrl: `https://korczakxyzmain.gatsbyjs.io/`,
  },
}
