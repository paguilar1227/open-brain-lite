import { Fragment } from 'react';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

interface Props {
  crumbs: Crumb[];
}

export function Topbar({ crumbs }: Props) {
  return (
    <header className="topbar">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="sep">›</span> : null}
            <span className={i === crumbs.length - 1 ? '' : 'ctx'} onClick={c.onClick}>
              {c.label}
            </span>
          </Fragment>
        ))}
      </div>
    </header>
  );
}
