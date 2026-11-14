import { useEffect } from 'react';

/** Sets the document title for the mounted page — SPA routes otherwise
    share one static title, which screen-reader users cannot distinguish. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
