"""
مشهد تجريبي — دورة تبريد مبسطة (Cooling Cycle).
يُستخدم للتحقق من أن خط أنابيب التحريك يعمل من الطرف إلى الطرف.
اللصق في المشروع: server/anim/scenes/CoolingCycle.py (مرجع للوكيل عند التوليد).
"""
from manim import Scene, Square, Arrow, Text, VGroup, Create, Write, FadeIn, BLUE, GREEN, ORANGE, RED, UP, DOWN, LEFT, RIGHT


class CoolingCycle(Scene):
    """أربع مراحل لدورة التبريد في حلقة مغلقة."""

    def construct(self):
        box = Square(side_length=3.0, color=BLUE)
        self.play(Create(box))

        stages = [
            ("1. Compress", UP),
            ("2. Condense", RIGHT),
            ("3. Expand", DOWN),
            ("4. Evaporate", LEFT),
        ]
        colors = [RED, ORANGE, GREEN, BLUE]

        labels = VGroup()
        for i, (name, direction) in enumerate(stages):
            label = Text(name, font_size=24, color=colors[i])
            label.next_to(box, direction, buff=0.4)
            labels.add(label)

        for label in labels:
            self.play(Write(label), run_time=0.8)

        arrows = VGroup(*[
            Arrow(box.get_corner(UP + LEFT) * 0.9, box.get_corner(UP + RIGHT) * 0.9, buff=0.1, color=RED),
            Arrow(box.get_corner(UP + RIGHT) * 0.9, box.get_corner(DOWN + RIGHT) * 0.9, buff=0.1, color=ORANGE),
            Arrow(box.get_corner(DOWN + RIGHT) * 0.9, box.get_corner(DOWN + LEFT) * 0.9, buff=0.1, color=GREEN),
            Arrow(box.get_corner(DOWN + LEFT) * 0.9, box.get_corner(UP + LEFT) * 0.9, buff=0.1, color=BLUE),
        ])
        for arrow in arrows:
            self.play(FadeIn(arrow), run_time=0.6)

        self.wait(2)
