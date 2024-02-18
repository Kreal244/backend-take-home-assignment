import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  NonEmptyStringSchema,
  CountSchema,
  IdSchema,
} from '@/utils/server/base-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) =>
        /**
         * Question 4: Implement mutual friend count
         *
         * Add `mutualFriendCount` to the returned result of this query. You can
         * either:
         *  (1) Make a separate query to count the number of mutual friends,
         *  then combine the result with the result of this query
         *  (2) BONUS: Use a subquery (hint: take a look at how
         *  `totalFriendCount` is implemented)
         *
         * Instructions:
         *  - Go to src/server/tests/friendship-request.test.ts, enable the test
         * scenario for Question 3
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/SelectQueryBuilder.html#innerJoin
         */
        conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .innerJoin(
            userTotalFriendCount(conn).as('userTotalFriendCount'),
            'userTotalFriendCount.userId',
            'friends.id'
          )
          .innerJoin(
            mutualFriendCount(conn, ctx.session.userId).as('mutualFriendCount'),
            'mutualFriendCount.userId',
            'friends.id'
          )
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['accepted']
          )
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            'totalFriendCount',
            'mutualFriendCount.mutualFriendCount',
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
              mutualFriendCount: CountSchema,
            }).parse
          )
      )
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
// group userId by friendUserId then
const mutualFriendCount = (db: Database, userId: number) => {
  //group userId by friendUserId
  const mutualFriendGroup = db
    .selectFrom('friendships')
    .select((eb) => [
      'friendships.friendUserId',
      'friendships.userId',
      eb.fn.sum('friendships.userId').as('mutualFriendCount'),
    ])
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .groupBy('friendships.friendUserId')
    .as('mutualfriend_group')
  //count mutual friend based on userId join with mutualFriendGroup
  return db
    .selectFrom((eb) =>
      eb
        .selectFrom(mutualFriendGroup)
        .innerJoin(
          'friendships',
          'mutualfriend_group.friendUserId',
          'friendships.friendUserId'
        )
        .select([
          'mutualfriend_group.userId as mutualFriendId',
          'friendships.userId',
        ])
        .where('friendships.friendUserId', '=', userId)
        .where('mutualfriend_group.userId', '!=', userId)
        .where('mutualfriend_group.mutualFriendCount', '>', 1)
        .as('mutalFriendList')
    )
    .select((eb) => [
      'mutalFriendList.userId',
      eb.fn.count('mutalFriendList.mutualFriendId').as('mutualFriendCount'),
    ])
    .groupBy('mutalFriendList.userId')
}
