import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAppState, useActions, useEffects } from 'app/overmind';
import { sortBy } from 'lodash-es';

import {
  Button,
  Element,
  Stack,
  Text,
  Input,
  Textarea,
  IconButton,
  Menu,
  Icon,
  Badge,
  MessageStripe,
} from '@codesandbox/components';
import css from '@styled-system/css';
import { UserSearchInput } from 'app/components/UserSearchInput';
import { Header } from 'app/pages/Dashboard/Components/Header';
import {
  dashboard,
  teamInviteLink,
} from '@codesandbox/common/lib/utils/url-generator';
import { TeamAvatar } from 'app/components/TeamAvatar';
import {
  TeamMemberAuthorization,
  CurrentTeamInfoFragmentFragment,
  SubscriptionOrigin,
  SubscriptionInterval,
} from 'app/graphql/types';
import { MAX_PRO_EDITORS } from 'app/constants';
import { useWorkspaceAuthorization } from 'app/hooks/useWorkspaceAuthorization';
import { useGetCheckoutURL } from 'app/hooks';
import track from '@codesandbox/common/lib/utils/analytics';
import { useWorkspaceSubscription } from 'app/hooks/useWorkspaceSubscription';
import { useWorkspaceLimits } from 'app/hooks/useWorkspaceLimits';
import { pluralize } from 'app/utils/pluralize';
import { Card } from '../components';
import { MemberList, User } from '../components/MemberList';
import { ManageSubscription } from './ManageSubscription';

const INVITE_ROLES_MAP = {
  [TeamMemberAuthorization.Admin]: [
    TeamMemberAuthorization.Admin,
    TeamMemberAuthorization.Write,
    TeamMemberAuthorization.Read,
  ],
  [TeamMemberAuthorization.Write]: [TeamMemberAuthorization.Read],

  [TeamMemberAuthorization.Read]: [] as TeamMemberAuthorization[],
};

const ROLES_TEXT_MAP = {
  [TeamMemberAuthorization.Admin]: 'Admin',
  [TeamMemberAuthorization.Write]: 'Editor',
  [TeamMemberAuthorization.Read]: 'Viewer',
};

export const WorkspaceSettings = () => {
  const actions = useActions();
  const effects = useEffects();
  const {
    user: currentUser,
    activeTeamInfo: team,
    dashboard: { teams },
  } = useAppState();

  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);

  const {
    isPro,
    isFree,
    isEligibleForTrial,
    numberOfSeats,
    subscription,
  } = useWorkspaceSubscription();
  const {
    numberOfEditors,
    hasMaxNumberOfEditors,
    numberOfEditorsIsOverTheLimit,
  } = useWorkspaceLimits();
  const { isTeamAdmin, userRole, isTeamEditor } = useWorkspaceAuthorization();

  const checkoutUrl = useGetCheckoutURL({
    cancel_path: dashboard.settings(team?.id),
  });

  const membersCount = team.users.length;
  const canInviteOtherMembers = isTeamAdmin || isTeamEditor;

  // We use `role` as the common term when referring to: `admin`, `editor` or `viewer`
  // But away from the team settings page and on the BE, the term `authorization` is used
  const rolesThatUserCanInvite =
    hasMaxNumberOfEditors || numberOfEditorsIsOverTheLimit
      ? // If team has reached the limit, only allow viewer roles to be invited
        [TeamMemberAuthorization.Read]
      : INVITE_ROLES_MAP[userRole];

  const getFile = async avatar => {
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        resolve(e.target.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(avatar);
    });

    const stringUrl = url as string;

    setFile({
      name: avatar.name,
      url: stringUrl,
    });
  };

  const handleTeamNameChange = event => {
    const { value } = event.target;

    // Get the input and remove any whitespace from both ends.
    const trimmedName = value?.trim() ?? '';

    // Validate if the name input is filled with whitespaces.
    if (!trimmedName) {
      event.target.setCustomValidity('Team name is required.');
    } else if (teams.find(t => t.name === trimmedName)) {
      event.target.setCustomValidity(
        'Name already taken, please choose a new name.'
      );
    } else {
      event.target.setCustomValidity('');
    }
  };

  const onSubmit = async event => {
    event.preventDefault();

    const name = event.target.name.value?.trim();
    const description = event.target.description.value?.trim();

    if (!name) {
      return;
    }

    setLoading(true);
    // no try/catch because setTeamInfo dispatches
    // a notification toast on error.
    await actions.dashboard.setTeamInfo({
      name,
      description,
      file,
    });
    setEditing(false);
  };

  const [inviteValue, setInviteValue] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const defaultRoleToInvite = rolesThatUserCanInvite.includes(
    team?.settings.defaultAuthorization
  )
    ? team?.settings.defaultAuthorization
    : TeamMemberAuthorization.Read;

  const [newMemberRole, setNewMemberRole] = React.useState<
    TeamMemberAuthorization
  >(defaultRoleToInvite);

  // A team can have unused seats in their subscription
  // if they have already paid for X editors for the YEARLY plan
  // then removed some members from the team
  const numberOfUnusedSeats = numberOfSeats - numberOfEditors;

  // if the user is going to be charged for adding a member
  // throw them a confirmation modal
  const confirmNewMemberAddition =
    isPro &&
    numberOfUnusedSeats === 0 &&
    newMemberRole !== TeamMemberAuthorization.Read;
  const confirmMemberRoleChange = isPro && numberOfUnusedSeats === 0;

  const onInviteSubmit = async event => {
    event.preventDefault();
    setInviteLoading(true);

    const inviteLink = teamInviteLink(team.inviteToken);

    await actions.dashboard.inviteToTeam({
      value: inviteValue,
      authorization: newMemberRole,
      confirm: confirmNewMemberAddition,
      triggerPlace: 'settings',
      inviteLink,
    });
    setInviteLoading(false);
  };

  if (!team || !currentUser) {
    return <Header title="Team Settings" activeTeam={null} />;
  }

  const onCopyInviteUrl = async event => {
    event.preventDefault();

    if (confirmNewMemberAddition) {
      const confirmed = await actions.modals.alertModal.open({
        title: 'Invite New Member',
        customComponent: 'MemberPaymentConfirmation',
      });
      if (!confirmed) return;
    }

    const inviteLink = teamInviteLink(team.inviteToken);

    actions.track({
      name: 'Dashboard - Copied Team Invite URL',
      data: { place: 'settings', inviteLink },
    });
    effects.browser.copyToClipboard(inviteLink);
    effects.notificationToast.success('Copied Team Invite URL!');
  };

  const created = team.users.find(user => user.id === team.creatorId);
  const canConvertViewersToEditors =
    !hasMaxNumberOfEditors && !numberOfEditorsIsOverTheLimit;

  return (
    <>
      <Element
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1em',

          '@media (min-width: 768px)': {
            display: 'grid',
            'grid-template-columns': 'repeat(3, 1fr)',
          },
        }}
      >
        <Card
          css={{
            'grid-column': isTeamAdmin || isEligibleForTrial ? 'auto' : '1/3',
          }}
        >
          {editing ? (
            <Stack as="form" onSubmit={onSubmit} direction="vertical" gap={2}>
              <Stack gap={4}>
                <Element css={css({ position: 'relative', height: 55 })}>
                  <TeamAvatar
                    style={{
                      opacity: 0.6,
                    }}
                    name={team.name}
                    avatar={file ? file.url : team.avatarUrl}
                    size="bigger"
                  />
                  <label htmlFor="avatar" aria-label="Upload your avatar">
                    <input
                      css={css({
                        width: '0.1px',
                        height: '0.1px',
                        opacity: 0,
                        overflow: 'hidden',
                        position: 'absolute',
                        zIndex: -1,
                      })}
                      type="file"
                      onChange={e => getFile(e.target.files[0])}
                      id="avatar"
                      name="avatar"
                      accept="image/png, image/jpeg"
                    />
                    <Element
                      css={css({
                        width: '100%',
                        height: '100%',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        cursor: 'pointer',
                      })}
                    >
                      <svg
                        width={18}
                        height={15}
                        fill="none"
                        viewBox="0 0 18 15"
                        css={css({
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                        })}
                      >
                        <path
                          fill="#fff"
                          fillRule="evenodd"
                          d="M13 2h3.286C17.233 2 18 2.768 18 3.714v9.572c0 .947-.767 1.714-1.714 1.714H1.714A1.714 1.714 0 010 13.286V3.714C0 2.768.768 2 1.714 2H5a4.992 4.992 0 014-2c1.636 0 3.088.786 4 2zm0 6a4 4 0 11-8 0 4 4 0 018 0zM8.8 6h.4v1.8H11v.4H9.2V10h-.4V8.2H7v-.4h1.8V6z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Element>
                  </label>
                </Element>
                <Stack
                  direction="vertical"
                  css={css({ width: '100%' })}
                  gap={2}
                >
                  <Input
                    type="text"
                    name="name"
                    required
                    defaultValue={team.name}
                    placeholder="Enter team name"
                    onChange={handleTeamNameChange}
                  />
                  <Textarea
                    name="description"
                    defaultValue={team.description}
                    placeholder="Enter a description for your team"
                  />
                </Stack>
              </Stack>
              <Stack justify="flex-end">
                <Button
                  variant="link"
                  css={{ width: 100 }}
                  disabled={loading}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  css={{ width: 100 }}
                  disabled={loading}
                  loading={loading}
                >
                  Save
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack gap={4}>
              <TeamAvatar
                name={team.name}
                avatar={team.avatarUrl}
                size="bigger"
              />
              <Stack direction="vertical" css={{ width: '100%' }} gap={1}>
                <Stack justify="space-between" align="center">
                  <Text size={4} weight="500" css={{ wordBreak: 'break-all' }}>
                    {team.name}
                  </Text>
                  {isTeamAdmin && (
                    <IconButton
                      variant="square"
                      name="edit"
                      size={12}
                      title="Edit team"
                      onClick={() => setEditing(true)}
                    />
                  )}
                </Stack>

                <Stack>
                  {isFree ? <Badge variant="trial">Free</Badge> : null}
                </Stack>

                <Text size={3} css={{ marginTop: '8px' }} variant="muted">
                  {team.description}
                </Text>
              </Stack>
            </Stack>
          )}
        </Card>

        <Card>
          <Stack
            direction="vertical"
            justify="space-between"
            css={{ height: '100%' }}
          >
            <Stack direction="vertical" gap={4}>
              <Text size={4} weight="500">
                {membersCount}{' '}
                {pluralize({
                  word: 'member',
                  count: membersCount,
                })}
              </Text>
              <Stack direction="vertical" gap={1}>
                {isTeamAdmin && (
                  <>
                    <Text size={3} variant="muted">
                      {numberOfEditors}{' '}
                      {numberOfEditors > 1 ? 'Editors' : 'Editor'}
                    </Text>
                    {numberOfUnusedSeats > 0 ? (
                      <Text size={3} variant="muted">
                        +{numberOfUnusedSeats} unassigned editor{' '}
                        {pluralize({
                          word: 'seat',
                          count: numberOfUnusedSeats,
                        })}
                      </Text>
                    ) : null}
                  </>
                )}
                {created && (
                  <Text size={3} variant="muted">
                    Created by {created.username}
                  </Text>
                )}
              </Stack>
            </Stack>
            {isTeamAdmin && (
              <Button
                autoWidth
                variant="link"
                disabled={loading}
                css={css({
                  height: 'auto',
                  fontSize: 3,
                  color: 'errorForeground',
                  padding: 0,
                })}
                onClick={() =>
                  actions.modalOpened({ modal: 'deleteWorkspace' })
                }
              >
                Delete team
              </Button>
            )}
          </Stack>
        </Card>

        <ManageSubscription />
      </Element>
      <Stack direction="vertical" gap={3}>
        <Text
          css={css({
            display: 'flex',
            alignItems: 'center',
          })}
          size={4}
        >
          Team overview
        </Text>

        {isTeamAdmin && (
          <Stack gap={10}>
            <Stack
              css={{
                fontSize: '13px',
                lineHeight: '16px',
                color: '#999999',
              }}
              gap={4}
            >
              <Text>
                {pluralize({
                  count: membersCount,
                  word: 'Member',
                })}
              </Text>
              <Text>{membersCount}</Text>
            </Stack>
            <Stack
              css={{
                fontSize: '13px',
                lineHeight: '16px',
                color: '#999999',
              }}
              gap={4}
            >
              <Text>Current editors</Text>
              <Text>
                {numberOfEditors}/{numberOfSeats}
              </Text>
            </Stack>
            {subscription?.billingInterval === SubscriptionInterval.Yearly && (
              <Stack
                css={{
                  fontSize: '13px',
                  lineHeight: '16px',
                  color: '#999999',
                }}
                gap={4}
              >
                <Text>Available editor seats</Text>
                <Text color="#B3FBB4">{numberOfUnusedSeats}</Text>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>

      {/**
       * Limit free plan amount of editors.
       */}
      {checkoutUrl && (numberOfEditorsIsOverTheLimit || hasMaxNumberOfEditors) && (
        <MessageStripe justify="space-between">
          <span>
            {numberOfEditorsIsOverTheLimit && (
              <>
                Free teams are limited to 5 editor seats. Some permissions might
                have changed.
              </>
            )}
            {hasMaxNumberOfEditors && (
              <>
                You&apos;ve reached the maximum amount of free editor seats.
                Upgrade for more.
              </>
            )}
          </span>
          <MessageStripe.Action
            {...(checkoutUrl.startsWith('/')
              ? {
                  as: RouterLink,
                  to: `${checkoutUrl}?utm_source=dashboard_workspace_settings`,
                }
              : {
                  as: 'a',
                  href: checkoutUrl,
                })}
            onClick={() => {
              if (isEligibleForTrial) {
                const event = 'Limit banner: team editors - Start trial';
                track(isTeamAdmin ? event : `${event} - As non-admin`, {
                  codesandbox: 'V1',
                  event_source: 'UI',
                });
              } else {
                track('Limit banner: team editors - Upgrade', {
                  codesandbox: 'V1',
                  event_source: 'UI',
                });
              }
            }}
          >
            {isEligibleForTrial ? 'Start trial' : 'Upgrade now'}
          </MessageStripe.Action>
        </MessageStripe>
      )}

      {/**
       * Soft limit for pro teams.
       */}
      {isTeamAdmin &&
        numberOfEditors > MAX_PRO_EDITORS &&
        subscription?.origin !== SubscriptionOrigin.Pilot && (
          <MessageStripe justify="space-between">
            <span>
              You have over {MAX_PRO_EDITORS} editors. Upgrade to the
              Organization plan for more benefits.
            </span>
            <MessageStripe.Action
              as="a"
              href="https://codesandbox.typeform.com/organization"
              onClick={() =>
                track('Limit banner - team editors - Custom plan contact')
              }
              target="_blank"
            >
              Contact us
            </MessageStripe.Action>
          </MessageStripe>
        )}

      {canInviteOtherMembers && (
        <Stack as="form" onSubmit={inviteLoading ? undefined : onInviteSubmit}>
          <div style={{ position: 'relative', width: '100%' }}>
            <UserSearchInput
              inputValue={inviteValue}
              allowSelf={false}
              onInputValueChange={val => setInviteValue(val)}
              style={{ paddingRight: 80 }}
            />

            <Menu>
              <Menu.Button
                css={css({
                  fontSize: 3,
                  fontWeight: 'normal',
                  paddingX: 0,
                  position: 'absolute',
                  top: 0,
                  right: 2,
                })}
              >
                <Text variant="muted">{ROLES_TEXT_MAP[newMemberRole]}</Text>
                <Icon name="caret" size={8} marginLeft={1} />
              </Menu.Button>
              <Menu.List>
                {rolesThatUserCanInvite.map(role => (
                  <Menu.Item
                    key={role}
                    onSelect={() => setNewMemberRole(role)}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <Text style={{ width: '100%' }}>
                      {ROLES_TEXT_MAP[role]}
                    </Text>
                    {newMemberRole === role && (
                      <Icon name="simpleCheck" size={12} marginLeft={1} />
                    )}
                  </Menu.Item>
                ))}
              </Menu.List>
            </Menu>
          </div>

          <Button
            type="submit"
            loading={inviteLoading}
            style={{ width: 'auto', marginLeft: 8 }}
          >
            Add Member
          </Button>

          <Button
            variant="secondary"
            onClick={onCopyInviteUrl}
            style={{ width: 'auto', marginLeft: 8 }}
          >
            Copy Invite URL
          </Button>
        </Stack>
      )}

      <div>
        <MemberList
          getPermission={user => getRole(user, team)}
          getPermissionOptions={user => {
            const userRoleIsViewer =
              getRole(user, team) === TeamMemberAuthorization.Read;

            // if changing the role will lead to extra seats, we want to
            // confirm any payment changes if required
            const confirmChange = confirmMemberRoleChange && userRoleIsViewer;

            return isTeamAdmin &&
              user.id !== currentUser.id &&
              (!userRoleIsViewer ||
                (userRoleIsViewer && canConvertViewersToEditors))
              ? [
                  {
                    label: 'Admin',
                    onSelect: () => {
                      actions.dashboard.changeAuthorization({
                        userId: user.id,
                        authorization: TeamMemberAuthorization.Admin,
                        confirm: confirmChange,
                      });
                    },
                  },
                  {
                    label: 'Editor',
                    onSelect: () => {
                      actions.dashboard.changeAuthorization({
                        userId: user.id,
                        authorization: TeamMemberAuthorization.Write,
                        confirm: confirmChange,
                      });
                    },
                  },
                  {
                    label: 'Viewer',
                    onSelect: () => {
                      actions.dashboard.changeAuthorization({
                        userId: user.id,
                        authorization: TeamMemberAuthorization.Read,
                      });
                    },
                  },
                ]
              : [];
          }}
          getActions={user => {
            const you = currentUser.id === user.id;

            const options = [];

            if (you) {
              options.push({
                label: 'Leave Workspace',
                onSelect: () => actions.dashboard.leaveTeam(),
              });
            }

            if (!you && isTeamAdmin) {
              options.push({
                label: 'Remove Member',
                onSelect: () => actions.dashboard.removeFromTeam(user.id),
              });
            }

            return options;
          }}
          users={sortBy(team.users, 'username')}
        />

        <MemberList
          getPermission={() => 'PENDING'}
          getPermissionOptions={() => []}
          getActions={user =>
            canInviteOtherMembers
              ? [
                  {
                    label: 'Revoke Invitation',
                    onSelect: () =>
                      actions.dashboard.revokeTeamInvitation({
                        teamId: team.id,
                        userId: user.id,
                      }),
                  },
                ]
              : []
          }
          users={sortBy(team.invitees, 'username')}
        />
      </div>
    </>
  );
};

const getRole = (
  user: User,
  team: CurrentTeamInfoFragmentFragment
): TeamMemberAuthorization => {
  const role = team.userAuthorizations.find(auth => auth.userId === user.id)
    .authorization;

  return role;
};
