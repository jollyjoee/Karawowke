import { z } from 'zod';
import {
  ClientRoleSchema,
  DownloadStatusSchema,
  PitchSemitonesSchema,
  PlayerStateSchema,
  PlayerStatusSchema,
  ReactionTypeSchema,
  ToastMessageSchema,
  VideoIdSchema,
} from './schemas.js';

/**
 * Messages sent from clients (/player or /remote) to the Raspberry Pi daemon.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    role: ClientRoleSchema,
    pin: z.string().max(32).optional(),
    nickname: z.string().trim().min(1).max(40).optional(),
    clientId: z.string().min(1).max(64).optional(),
  }),
  z.object({
    type: z.literal('ping'),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('queue:add'),
    videoId: VideoIdSchema,
    title: z.string().trim().min(1).max(300),
    channel: z.string().trim().max(200).default('Unknown Channel'),
    durationSec: z.number().nonnegative().default(0),
    thumbnailUrl: z.string().max(1000).default(''),
    requestedBy: z.string().trim().min(1).max(40).optional(),
    pitchSemitones: PitchSemitonesSchema.default(0),
  }),
  z.object({
    type: z.literal('queue:remove'),
    itemId: z.string().min(1),
  }),
  z.object({
    type: z.literal('queue:reorder'),
    itemId: z.string().min(1),
    targetIndex: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('queue:playNext'),
    itemId: z.string().min(1),
  }),
  z.object({
    type: z.literal('queue:clear'),
  }),
  z.object({
    type: z.literal('player:play'),
  }),
  z.object({
    type: z.literal('player:pause'),
  }),
  z.object({
    type: z.literal('player:restart'),
  }),
  z.object({
    type: z.literal('player:skip'),
  }),
  z.object({
    type: z.literal('player:seek'),
    timeSec: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('player:setVolume'),
    volume: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal('player:setMuted'),
    isMuted: z.boolean(),
  }),
  z.object({
    type: z.literal('player:setPitch'),
    pitchSemitones: PitchSemitonesSchema,
  }),
  z.object({
    type: z.literal('player:reportProgress'),
    currentTimeSec: z.number().nonnegative(),
    status: PlayerStatusSchema.optional(),
  }),
  z.object({
    type: z.literal('player:trackEnded'),
    itemId: z.string().min(1),
  }),
  z.object({
    type: z.literal('player:trackError'),
    itemId: z.string().min(1),
    message: z.string().max(400),
  }),
  z.object({
    type: z.literal('reaction:send'),
    reaction: ReactionTypeSchema,
    senderName: z.string().trim().min(1).max(40).optional(),
  }),
  z.object({
    type: z.literal('settings:update'),
    showCornerQr: z.boolean().optional(),
    guestCanSkip: z.boolean().optional(),
    roomPin: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{4,12}$/, 'Room PIN must be 4-12 alphanumeric characters')
      .optional(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Messages broadcast from the Raspberry Pi daemon to connected clients.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth:ok'),
    role: ClientRoleSchema,
    clientId: z.string().min(1),
    state: PlayerStateSchema,
  }),
  z.object({
    type: z.literal('auth:error'),
    code: z.enum(['INVALID_PIN', 'UNAUTHORIZED', 'BAD_REQUEST']),
    message: z.string(),
  }),
  z.object({
    type: z.literal('pong'),
    ts: z.number().int().nonnegative(),
    serverTs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('state:sync'),
    state: PlayerStateSchema,
  }),
  z.object({
    type: z.literal('download:progress'),
    itemId: z.string().min(1),
    videoId: VideoIdSchema,
    status: DownloadStatusSchema,
    progress: z.number().min(0).max(100),
    errorMessage: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('pitch:status'),
    itemId: z.string().min(1),
    videoId: VideoIdSchema,
    pitchSemitones: PitchSemitonesSchema,
    status: z.enum(['processing', 'ready', 'error']),
    errorMessage: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('toast'),
    toast: ToastMessageSchema,
  }),
  z.object({
    type: z.literal('reaction'),
    id: z.string().min(1),
    reaction: ReactionTypeSchema,
    senderName: z.string().min(1),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('command'),
    action: z.enum(['seek', 'restart', 'reload_media']),
    timeSec: z.number().nonnegative().optional(),
    pitchSemitones: PitchSemitonesSchema.optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
