import { INSTRUCTORS, type InstructorId } from "@/domain/demo-catalog";
type InstructorDisplay = {
  name: string;
  initials: string;
  role: string;
  bio: string;
};
type InstructorProps =
  | { id: InstructorId; profile?: never }
  | { id?: never; profile: InstructorDisplay };
function instructorDisplay(props: InstructorProps) {
  return props.profile ?? INSTRUCTORS[props.id];
}
export function InstructorIdentity(props: InstructorProps) {
  const instructor = instructorDisplay(props);
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
export function InstructorProfile(props: InstructorProps) {
  const instructor = instructorDisplay(props);
  return (
    <article
      className="trainer-card trainer-profile"
      aria-label={instructor.name}
    >
      <div className="trainer-heading">
        <InstructorIdentity {...props} />
      </div>
      <p className="trainer-bio">{instructor.bio}</p>
    </article>
  );
}
