import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

export function Formula({ tex }: { tex: string }) {
  const html = useMemo(
    () => katex.renderToString(tex, { throwOnError: false, displayMode: false }),
    [tex],
  );
  return <span className="formula" dangerouslySetInnerHTML={{ __html: html }} />;
}
