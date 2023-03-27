const path = require('path');
const postTemplate = path.resolve('./src/templates/blog-post.js');
const courseTemplate = path.resolve('./src/templates/course.js');

exports.createPages = async ({ graphql, actions }) => {
  const { data } = await graphql(`
    query {
      blogPosts: allMdx(filter: {internal: {contentFilePath: {regex: "/blog/"}}}) {
        nodes {
          frontmatter {
            slug
          }
          internal {
            contentFilePath
          }
        }
      }
      courses: allMdx(filter: {internal: {contentFilePath: {regex: "/courses/"}}}) {
        nodes {
          frontmatter {
            slug
          }
          internal {
            contentFilePath
          }
        }
      }
    }
  `);

  // Create blog pages
  data.blogPosts.nodes.forEach(node => {
    actions.createPage({
      path: '/blog/' + node.frontmatter.slug,
      component: `${postTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: { slug: node.frontmatter.slug },
    });
  });

  // Create course pages
  data.courses.nodes.forEach(node => {
    actions.createPage({
      path: '/courses/' + node.frontmatter.slug,
      component: `${courseTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: { slug: node.frontmatter.slug },
    });
  });
};
