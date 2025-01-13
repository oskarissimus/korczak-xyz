import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next';
import React from 'react';

function useMainNavMenuData() {
  const { languages, originalPath } = useI18next();
  const { t } = useTranslation();

  const navigation = React.useMemo(
    () => [
      { name: t('Home'), to: '/' },
      { name: t('About'), to: '/about' },
      { name: t('Mentoring'), to: '/mentoring' },
      { name: t('Courses'), to: '/courses' },
      { name: t('Blog'), to: '/blog' },
      { name: t('Songs'), to: '/songs' },
    ],
    [t],
  );

  return { languages, originalPath, navigation };
}

export default useMainNavMenuData;
