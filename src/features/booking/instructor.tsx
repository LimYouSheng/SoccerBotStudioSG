import { INSTRUCTORS, type InstructorId } from "@/domain/catalog";
export function InstructorIdentity({ id }: { id: InstructorId }) {
  const instructor = INSTRUCTORS[id];
  return (
    <>
      <span className="trainer-avatar" aria-hidden="true">
        {instructor.initials}
      </span>
      <div className="trainer-identity">
        <h3>{instructor.name}</h3>
        <span>{instructor.role}</span>
      </div>
    </>
  );
}
export function InstructorProfile({ id }: { id: InstructorId }) {
  return (
    <article
      className="trainer-card trainer-profile"
      aria-label={INSTRUCTORS[id].name}
    >
      <div className="trainer-heading">
        <InstructorIdentity id={id} />
      </div>
      <p className="trainer-bio">{INSTRUCTORS[id].bio}</p>
    </article>
  );
}
