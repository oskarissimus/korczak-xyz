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
            language
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
            language
          }
          internal {
            contentFilePath
          }
        }
      }
      plugin: sitePlugin(name: {eq: "gatsby-plugin-react-i18next"}) {
        pluginOptions
      }
    }
  `);
  const defaultLanguage = data.plugin.pluginOptions.defaultLanguage;
  console.log(`defaultLanguage = ${defaultLanguage}`);
  function languagePath(language) {
    return language === defaultLanguage ? '' : '/' + language;
  }

  // Create course pages
  data.courses.nodes.forEach(node => {
    console.log(`Creating course page for ${node.frontmatter.slug} in ${node.frontmatter.language}`);
    const page = {
      path: languagePath(node.frontmatter.language) + '/courses/' + node.frontmatter.slug,
      matchPath: languagePath(node.frontmatter.language) + '/courses/' + node.frontmatter.slug,
      component: `${courseTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: {
        slug: node.frontmatter.slug,
        language: node.frontmatter.language,
      },
    };
    console.log(page);
    actions.createPage(page);
  });

  // Create blog pages
  data.blogPosts.nodes.forEach(node => {
    console.log(`Creating blog page for ${node.frontmatter.slug}`);
    const page = {
      path: languagePath(node.frontmatter.language) + '/blog/' + node.frontmatter.slug,
      matchPath: languagePath(node.frontmatter.language) + '/blog/' + node.frontmatter.slug,
      component: `${postTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: {
        slug: node.frontmatter.slug,
        language: node.frontmatter.language,
      },
    };
    console.log(page);
    actions.createPage(page);
  });
};
