import { GatsbyNode } from 'gatsby';
import path from 'path';

const postTemplate = path.resolve('./src/templates/blog-post.js');
const courseTemplate = path.resolve('./src/templates/course.js');

export const createPages: GatsbyNode['createPages'] = async ({
  graphql,
  actions,
}) => {
  const result = await graphql<Queries.CreatePagesQuery>(`
    query CreatePages {
      blogPosts: allMdx(
        filter: { internal: { contentFilePath: { regex: "/blog/" } } }
      ) {
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
      courses: allMdx(
        filter: { internal: { contentFilePath: { regex: "/courses/" } } }
      ) {
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
      plugin: sitePlugin(name: { eq: "gatsby-plugin-react-i18next" }) {
        pluginOptions
      }
    }
  `);
  if (result.errors || !result.data) {
    console.error('Error fetching data for createPages:', result.errors);
    return;
  }
  const data = result.data;
  const defaultLanguage = data?.plugin?.pluginOptions?.defaultLanguage;

  function languagePath(language: string) {
    return language === defaultLanguage ? '' : '/' + language;
  }

  // Create course pages
  data.courses.nodes.forEach((node: any) => {
    const page = {
      path:
        languagePath(node.frontmatter.language) +
        '/courses/' +
        node.frontmatter.slug,
      matchPath:
        languagePath(node.frontmatter.language) +
        '/courses/' +
        node.frontmatter.slug,
      component: `${courseTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: {
        slug: node.frontmatter.slug,
        language: node.frontmatter.language,
      },
    };
    actions.createPage(page);
  });

  // Create blog pages
  data.blogPosts.nodes.forEach((node: any) => {
    const page = {
      path:
        languagePath(node.frontmatter.language) +
        '/blog/' +
        node.frontmatter.slug,
      matchPath:
        languagePath(node.frontmatter.language) +
        '/blog/' +
        node.frontmatter.slug,
      component: `${postTemplate}?__contentFilePath=${node.internal.contentFilePath}`,
      context: {
        slug: node.frontmatter.slug,
        language: node.frontmatter.language,
      },
    };
    actions.createPage(page);
  });
};
