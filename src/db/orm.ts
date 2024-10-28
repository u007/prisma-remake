
import type {
  ORM as GeneratedORM,
  Include,
  OrderBy,
  QueryOptions,
  User,
  Address,
  Post,
  Profile,
  Tag
} from "./generatedTypes";
import { createORM, type DrizzleORM } from "@prisma/orm_drizzle";
type ModelName = "User" | "Address" | "Post" | "Profile" | "Tag";
type ModelType = User | Address | Post | Profile | Tag;

export const prisma = (() => {
  const orm = new Proxy(createORM(), {
    get: (target: DrizzleORM, prop: string | symbol) => {
      if (typeof prop === "string" && prop in target.extensions) {
        const extension = target.extensions[prop];
        return extension.bind(target);
      }
      return Reflect.get(target, prop);
    },
  });
  orm.$connect();

  orm.user = orm.createModelProxy<User>("User");
  orm.address = orm.createModelProxy<Address>("Address");
  orm.post = orm.createModelProxy<Post>("Post");
  orm.profile = orm.createModelProxy<Profile>("Profile");
  orm.tag = orm.createModelProxy<Tag>("Tag");

  return orm
})()

if (require.main === module) {
  (async () => {
    try {
      console.log('prisma', prisma);
      const user = await prisma.user.findMany({
        include: {
          posts: true,
          profile: true,
        },
      });
      console.log('Test query result:', JSON.stringify(user, null, 2));
    } catch (error) {
      console.error('Query error:', error);
    } finally {
      await prisma.$disconnect();
    }
  })();
}
