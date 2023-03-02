const path = require('path')
const postTemplate = path.resolve('./src/templates/blog-post.js')

exports.createPages = async ({ graphql, actions }) => {
  const { data } = await graphql(`query BlogPosts {
      allMdx {
          nodes {
            frontmatter {
              slug
            }
            internal {
              contentFilePath
            }
          }
        }
      }`)

  data.allMdx.nodes.forEach(node => {
    actions.createPage({
      path: '/blog/' + node.frontmatter.slug,
      component: `${postTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: { slug: node.frontmatter.slug }
    })
  })
}