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
         *  (4) Make a separate query to count the number of mutual friends,
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
          .leftJoin(
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
    // get all friends as a list
    getAllFriendsList: protectedProcedure
      .mutation(async ({ ctx }) => {
        return ctx.db.transaction().execute(async (t) =>
        {
          //get user information base on userId
          const user = await t.selectFrom('users').selectAll().where('id', '=', ctx.session.userId).executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          //get all friends base on UserId
          const friensList = await t.selectFrom(getFriendList(t, ctx.session.userId)).selectAll().execute()
          return {
            user,
            friensList
          }
        }
        ).then(res => {
          // combine friend list as array object
          const friendList = z.array(
            z.object({
              friendUserId: IdSchema,
              friendFullName: NonEmptyStringSchema,
              friendPhoneNumber: NonEmptyStringSchema,
            })
          ).parse(res.friensList);
          // combine user information as object
          const userSchema = z.object({
            id: IdSchema,
            fullName: NonEmptyStringSchema,
            phoneNumber: NonEmptyStringSchema,
          }).parse(res.user)
          return {
            ...userSchema,
            friendList: friendList
          }
      })}
    )
}
)

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

const mutualFriendCount = (db: Database, userId: number) => {

  //get all friends base on User Id
  const getMutalFriend = db.selectFrom('friendships')
    .where('friendships.userId', '=', userId)
    .select([
      'friendships.friendUserId'
    ]);
  // get count mutal friends who have accepted friendship request
  return db.selectFrom('friendships')
    .where('friendships.friendUserId', 'in', getMutalFriend)
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId')
        .filterWhere('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
        .filterWhere('friendships.userId','!=',userId)
        .as('mutualFriendCount'),
    ])
    .groupBy('friendships.userId')
}
// Extra function requested
/**
 * get friend list who has friendship with user by userId
 * */ 
const getFriendList = (db: Database, userId:number) => {
  return db
    .selectFrom('friendships')
    .innerJoin('users as friends', 'friends.id', 'friendships.friendUserId')
    .where('userId', '=', userId)
    .select([
      'friendships.friendUserId',
      'friends.fullName as friendFullName',
      'friends.phoneNumber as friendPhoneNumber',
    ])
    .as('listFriendInfo');
}