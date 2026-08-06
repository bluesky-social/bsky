import { app, com } from '../lexicons/index.js'
import { is$typedObject } from '../utils/types.js'
import {
  InterpretedLabelValueDefinition,
  LabelPreference,
  LabelValueDefinitionFlag,
  ModerationBehavior,
} from './types.js'

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object'
}

export function isQuotedPost(
  embed: unknown,
): embed is app.bsky.embed.record.View {
  return (
    isObject(embed) && is$typedObject(embed, app.bsky.embed.record.view.$type)
  )
}

export function isQuotedPostWithMedia(
  embed: unknown,
): embed is app.bsky.embed.recordWithMedia.View {
  return (
    isObject(embed) &&
    is$typedObject(embed, app.bsky.embed.recordWithMedia.view.$type)
  )
}

export function interpretLabelValueDefinition(
  def: com.atproto.label.defs.LabelValueDefinition,
  definedBy: string | undefined,
): InterpretedLabelValueDefinition {
  const behaviors: {
    account: ModerationBehavior
    profile: ModerationBehavior
    content: ModerationBehavior
  } = {
    account: {},
    profile: {},
    content: {},
  }
  const alertOrInform: 'alert' | 'inform' | undefined =
    def.severity === 'alert'
      ? 'alert'
      : def.severity === 'inform'
        ? 'inform'
        : undefined
  if (def.blurs === 'content') {
    // target=account, blurs=content
    behaviors.account.profileList = alertOrInform
    behaviors.account.profileView = alertOrInform
    behaviors.account.contentList = 'blur'
    behaviors.account.contentView = def.adultOnly ? 'blur' : alertOrInform
    // target=profile, blurs=content
    behaviors.profile.profileList = alertOrInform
    behaviors.profile.profileView = alertOrInform
    // target=content, blurs=content
    behaviors.content.contentList = 'blur'
    behaviors.content.contentView = def.adultOnly ? 'blur' : alertOrInform
  } else if (def.blurs === 'media') {
    // target=account, blurs=media
    behaviors.account.profileList = alertOrInform
    behaviors.account.profileView = alertOrInform
    behaviors.account.avatar = 'blur'
    behaviors.account.banner = 'blur'
    // target=profile, blurs=media
    behaviors.profile.profileList = alertOrInform
    behaviors.profile.profileView = alertOrInform
    behaviors.profile.avatar = 'blur'
    behaviors.profile.banner = 'blur'
    // target=content, blurs=media
    behaviors.content.contentMedia = 'blur'
  } else if (def.blurs === 'none') {
    // target=account, blurs=none
    behaviors.account.profileList = alertOrInform
    behaviors.account.profileView = alertOrInform
    behaviors.account.contentList = alertOrInform
    behaviors.account.contentView = alertOrInform
    // target=profile, blurs=none
    behaviors.profile.profileList = alertOrInform
    behaviors.profile.profileView = alertOrInform
    // target=content, blurs=none
    behaviors.content.contentList = alertOrInform
    behaviors.content.contentView = alertOrInform
  }

  let defaultSetting: LabelPreference = 'warn'
  if (def.defaultSetting === 'hide' || def.defaultSetting === 'ignore') {
    // cast safe: 'hide' | 'ignore' are LabelPreference values; checked by condition
    defaultSetting = def.defaultSetting as LabelPreference
  }

  const flags: LabelValueDefinitionFlag[] = ['no-self']
  if (def.adultOnly) {
    flags.push('adult')
  }

  return {
    ...def,
    definedBy,
    configurable: true,
    defaultSetting,
    flags,
    behaviors,
  }
}

export function interpretLabelValueDefinitions(
  labelerView: app.bsky.labeler.defs.LabelerViewDetailed,
): InterpretedLabelValueDefinition[] {
  return (labelerView.policies?.labelValueDefinitions || [])
    .filter((v): v is com.atproto.label.defs.LabelValueDefinition =>
      com.atproto.label.defs.labelValueDefinition.matches(v),
    )
    .map((labelValDef) =>
      interpretLabelValueDefinition(labelValDef, labelerView.creator.did),
    )
}
