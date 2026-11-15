import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, schema, type DatabaseConnection } from '@shiftora/db';

import { DATABASE } from '../../database/database.module.js';

const { users } = schema;
export type User = typeof users.$inferSelect;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  async findByEmail(email: string): Promise<User | null> {
    // citext column: matches any casing.
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  /** Returns null if the email is already taken (unique constraint, race-safe). */
  async create(values: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User | null> {
    const [user] = await this.database.db
      .insert(users)
      .values(values)
      .onConflictDoNothing({ target: users.email })
      .returning();
    return user ?? null;
  }

  async markEmailVerified(userId: string, at: Date): Promise<void> {
    await this.database.db
      .update(users)
      .set({ emailVerifiedAt: at })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.database.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }
}
