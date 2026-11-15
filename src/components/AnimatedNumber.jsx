import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

/** Butter-smooth rolling number, driven by a framer-motion spring. */
export default function AnimatedNumber({ value }) {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span>{display}</motion.span>;
}
