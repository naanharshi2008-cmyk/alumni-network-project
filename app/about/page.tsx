import type { Metadata } from 'next';
import Link from 'next/link';
import { SCHOOLS, SCHOOL_BOARD_BY_SCHOOL } from '../../lib/options';

export const metadata: Metadata = {
  title: 'About · Veveaham Alumni',
  description: 'What the Veveaham alumni network is for, how profiles are reviewed, and how your details are kept private.',
};

const CONTACT = 'alumni@dpmschools.com';

export default function AboutPage() {
  return (
    <main className="container about">
      <section className="about__hero fade-up">
        <span className="about__crest" aria-hidden>
          <img src="/brand/crest.png" alt="" width={256} height={256} />
        </span>
        <div>
          <p className="about__kicker">About the network</p>
          <h1>Seniors showing juniors the way.</h1>
          <p className="about__lead">
            Veveaham Alumni is a record of where students from the Veveaham group of schools went
            after class 12: the colleges they got into, how they got in, and what they would tell
            a junior standing where they once stood.
          </p>
        </div>
      </section>

      <section className="about__grid stagger">
        <div className="card about__card">
          <h2>What it&apos;s for</h2>
          <p>
            A class 11 student deciding between engineering and medicine, or wondering whether a
            rank is good enough, learns most from someone who sat in the same classrooms. Here
            they can find that senior, see the exam or marks that opened the door, and read
            their advice.
          </p>
        </div>

        <div className="card about__card">
          <h2>Every profile is reviewed</h2>
          <p>
            Nothing appears in the directory until the school has checked it. Later changes are
            reviewed the same way, so what juniors read stays accurate, and seniors can confirm
            from their profile that everything is still right.
          </p>
        </div>

        <div className="card about__card">
          <h2>Your contact details stay private</h2>
          <p>
            Your email address and phone number are never shown on the site. They are only
            used to sign you in and for the school to reach you. Your photo and LinkedIn appear
            only if you add them.
          </p>
        </div>
      </section>

      <section className="about__schools fade-up">
        <h2>Our schools</h2>
        <p className="subtitle">The board follows the school, so nobody has to pick it.</p>
        <div className="about__school-list">
          {SCHOOLS.map((school) => (
            <div key={school} className="about__school">
              <span className="about__school-name">{school}</span>
              <span className="about__board">{SCHOOL_BOARD_BY_SCHOOL[school]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="about__join card fade-up">
        <div>
          <h2>Join, or claim your profile</h2>
          <ol className="about__steps">
            <li><strong>Add your journey.</strong> Four short steps, with your email or phone number as your login.</li>
            <li><strong>The school reviews it.</strong> Once approved, juniors can find you in the directory.</li>
            <li><strong>Keep it current.</strong> Update your college, work and advice from your profile any time.</li>
          </ol>
          <p className="about__small">
            Already added by the school, or locked out? Use{' '}
            <Link href="/forgot-password">Forgot password</Link>, or write to{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and the school office will set up your login.
          </p>
        </div>
        <div className="about__cta">
          <Link href="/register" className="btn btn--primary btn--lg"><span className="btn__inner">Add your journey →</span></Link>
          <Link href="/directory" className="btn btn--ghost btn--lg"><span className="btn__inner">Browse the directory</span></Link>
        </div>
      </section>
    </main>
  );
}
