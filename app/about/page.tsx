import type { Metadata } from 'next';
import Link from 'next/link';
import { SCHOOLS, SCHOOL_BOARD_BY_SCHOOL } from '../../lib/options';
import { SCHOOL_GROUP_NAME } from '../../lib/types';

export const metadata: Metadata = {
  title: 'About',
  description: 'What the Veveaham alumni network is for, how profiles are reviewed, and how your details are kept private.',
};

const CONTACT = 'alumni@dpmschools.com';

export default function AboutPage() {
  return (
    <div className="container about">
      <section className="about__hero fade-up">
        <span className="about__crest" aria-hidden>
          <img src="/brand/crest.png" alt="" width={256} height={256} />
        </span>
        <div>
          <p className="about__kicker">About the network</p>
          <h1>Seniors showing juniors the way.</h1>
          <p className="about__lead">
            Veveaham Alumni is a record of where students from {SCHOOL_GROUP_NAME} went after
            class 12: the colleges and courses they went on to, how they got there, and what they
            have to say to a junior standing where they once stood.
          </p>
        </div>
      </section>

      <section className="about__grid stagger">
        <div className="card about__card">
          <h2>What it&apos;s for</h2>
          <p>
            Whatever a student is weighing up — the sciences, engineering, medicine, commerce and
            CA, law, design, defence, teaching, the arts, a university abroad — someone from these
            same classrooms has already walked some of it. This is where you find them.
          </p>
          <p>
            Not every door opens with an entrance exam either: board marks, a portfolio, an
            audition, an application. Seniors say which one they used, and what they would do
            differently.
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
          <h2>A page of your own</h2>
          <p>
            Every approved alumnus gets their own page, at an address with their name in it,
            so a junior can send it to a friend and so it can be found by searching. It shows
            only what you chose to share. Ask the school and it comes down.
          </p>
        </div>

        <div className="card about__card">
          <h2>Your contact details stay private</h2>
          <p>
            Your email address and phone number are never shown on the site, including on your
            own page. They are only used to sign you in and for the school to reach you. Your
            photo and LinkedIn appear only if you add them.
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
          <Link href="/directory" className="btn btn--ghost btn--lg"><span className="btn__inner">Explore alumni</span></Link>
        </div>
      </section>
    </div>
  );
}
