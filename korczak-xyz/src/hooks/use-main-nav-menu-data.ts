import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next';
import React from 'react';

function useMainNavMenuData() {
  const { languages, originalPath } = useI18next();
  const { t } = useTranslation();

  const navigation = React.useMemo(
    () => [
      { name: t('Home'), to: t('/') },
      { name: t('About'), to: t('/about') },
      { name: t('Mentoring'), to: t('/mentoring') },
      { name: t('Courses'), to: t('/courses') },
      { name: t('Blog'), to: t('/blog') },
      { name: t('Songs'), to: t('/songs') },
    ],
    [t],
  );

  return { languages, originalPath, navigation };
}

export default useMainNavMenuData;
