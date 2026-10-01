'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar } from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import { useTranslation } from 'react-i18next';

import type { OwnerSection } from './labels';
import { styles } from './styles';

interface OwnerHeaderProps {
  count: number;
  first: boolean;
  owner: OwnerSection['owner'];
}

/**
 * The heading over one part of the page: "My rules" for the reviewer's own, or the agent's
 * avatar and name over what that agent learned by itself.
 */
const OwnerHeader = ({ count, first, owner }: OwnerHeaderProps) => {
  const { t } = useTranslation('memory');

  return (
    <div className={cx(styles.owner, first && styles.ownerFirst)}>
      {owner.kind === 'agent' && (
        <Avatar
          avatar={owner.agent.avatar || DEFAULT_AVATAR}
          background={owner.agent.backgroundColor || cssVar.colorBgContainer}
          shape={'circle'}
          size={20}
          title={owner.agent.title ?? undefined}
          variant={'outlined'}
        />
      )}
      <span>
        {owner.kind === 'mine'
          ? t('rules.owner.mine')
          : owner.agent.title || t('rules.owner.untitledAgent')}
      </span>
      <span className={styles.ownerCount}>{count}</span>
    </div>
  );
};

export default OwnerHeader;
