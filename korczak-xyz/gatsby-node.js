const path = require('path')

exports.createPages = async ({ graphql, actions }) => {
    const { data } = await graphql(`query BlogPosts {
        allMarkdownRemark {
          nodes {
            frontmatter {
              slug
            }
          }
        }
      }`)

    data.allMarkdownRemark.nodes.forEach(node => {
        actions.createPage({
            path: '/blog/' + node.frontmatter.slug,
            component: path.resolve('./src/templates/blog-post.js'),
            context: { slug: node.frontmatter.slug }
        })
    })
}